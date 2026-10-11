import { describe, expect, it } from "vitest";
import {
  describeDuration,
  describeHistoryEntry,
  durationMsOf,
  parseStampMs,
  resolveHistoryStatus,
  toHistoryViews,
} from "./history";
import type { ScheduledRunHistoryEntry } from "./types";

function entry(overrides: Partial<ScheduledRunHistoryEntry> = {}): ScheduledRunHistoryEntry {
  return {
    id: 1,
    jobKey: "data_backup",
    startedAt: "2026-10-09 17:00:00",
    finishedAt: "2026-10-09 17:00:04",
    status: "ok",
    ...overrides,
  };
}

describe("parseStampMs", () => {
  it("reads a SQLite stamp as UTC, not local time", () => {
    // `Date.parse("2026-10-09 17:00:00")` is local in some engines; a stamp rendered
    // against any other clock would be hours out.
    expect(parseStampMs("2026-10-09 17:00:00")).toBe(Date.parse("2026-10-09T17:00:00Z"));
  });

  it("is undefined for an unparseable stamp", () => {
    expect(parseStampMs("not a date")).toBeUndefined();
  });
});

describe("durationMsOf", () => {
  it("measures start to finish", () => {
    const measured = durationMsOf(
      entry({ startedAt: "2026-10-09 17:00:00", finishedAt: "2026-10-09 17:00:42" }),
    );

    expect(measured).toBe(42_000);
  });

  it("is undefined when the pass never finished", () => {
    expect(durationMsOf(entry({ finishedAt: undefined, status: undefined }))).toBeUndefined();
  });

  it("is undefined when a stamp cannot be parsed", () => {
    expect(durationMsOf(entry({ finishedAt: "whenever" }))).toBeUndefined();
  });

  it("suppresses a negative duration rather than showing one", () => {
    // A clock change mid-pass. "-3s" reads as a bug in the screen, which it isn't.
    const measured = durationMsOf(
      entry({ startedAt: "2026-10-09 17:00:00", finishedAt: "2026-10-09 16:59:57" }),
    );

    expect(measured).toBeUndefined();
  });
});

describe("describeDuration", () => {
  it("keeps sub-second passes legible", () => {
    // The common case for the two prunes — rounding these to "0s" would make every
    // prune look identical.
    expect(describeDuration(820)).toBe("820ms");
    expect(describeDuration(0)).toBe("0ms");
  });

  it("shows seconds with one decimal under a minute", () => {
    expect(describeDuration(4_200)).toBe("4.2s");
    expect(describeDuration(59_900)).toBe("59.9s");
  });

  it("shows minutes and padded seconds under an hour", () => {
    expect(describeDuration(65_000)).toBe("1m 05s");
    expect(describeDuration(3_599_000)).toBe("59m 59s");
  });

  it("shows hours and padded minutes beyond that", () => {
    expect(describeDuration(7_380_000)).toBe("2h 03m");
  });
});

describe("resolveHistoryStatus", () => {
  it("never reports a missing status as success", () => {
    expect(resolveHistoryStatus(undefined)).toBe("interrupted");
    expect(resolveHistoryStatus("ok")).toBe("ok");
    expect(resolveHistoryStatus("failed")).toBe("failed");
  });
});

describe("toHistoryViews", () => {
  it("computes the duration and carries the stored facts through", () => {
    const views = toHistoryViews([
      entry({ id: 7, startedAt: "2026-10-09 17:00:00", finishedAt: "2026-10-09 17:00:05", detail: "3 copied" }),
    ]);

    expect(views[0]).toEqual({
      id: 7,
      startedAt: "2026-10-09 17:00:00",
      finishedAt: "2026-10-09 17:00:05",
      durationMs: 5_000,
      status: "ok",
      detail: "3 copied",
    });
  });

  it("marks a pass that never finished as interrupted with no duration", () => {
    const views = toHistoryViews([entry({ finishedAt: undefined, status: undefined })]);

    expect(views[0].status).toBe("interrupted");
    expect(views[0].durationMs).toBeUndefined();
    expect(views[0].finishedAt).toBeUndefined();
  });

  it("preserves the order it was given rather than re-sorting", () => {
    // The repository orders by id DESC; re-sorting here would paper over a
    // repository that had stopped doing so.
    const views = toHistoryViews([entry({ id: 3 }), entry({ id: 9 }), entry({ id: 5 })]);

    expect(views.map((view) => view.id)).toEqual([3, 9, 5]);
  });

  it("returns nothing for a job that has never run", () => {
    expect(toHistoryViews([])).toEqual([]);
  });
});

describe("describeHistoryEntry", () => {
  it("reads as one line with the duration and detail", () => {
    const [view] = toHistoryViews([
      entry({ startedAt: "2026-10-09 17:00:00", finishedAt: "2026-10-09 17:00:05", detail: "3 copied" }),
    ]);

    expect(describeHistoryEntry(view)).toBe("2026-10-09 17:00:00 UTC — ok in 5.0s — 3 copied");
  });

  it("says a pass did not finish instead of inventing an outcome", () => {
    const [view] = toHistoryViews([entry({ finishedAt: undefined, status: undefined })]);

    expect(describeHistoryEntry(view)).toBe("2026-10-09 17:00:00 UTC — did not finish");
  });
});
