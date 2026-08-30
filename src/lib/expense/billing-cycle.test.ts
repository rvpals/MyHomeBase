import { describe, expect, it } from "vitest";
import {
  DEFAULT_STATEMENT_CLOSE_DAY,
  cycleForDate,
  cycleLabel,
  normalizeCloseDay,
} from "./billing-cycle";

describe("cycleForDate", () => {
  it("puts a mid-cycle date between the previous close and this one", () => {
    const cycle = cycleForDate("2026-08-10", 28);
    expect(cycle).toEqual({
      startDate: "2026-07-29",
      endDate: "2026-08-28",
      key: "2026-08-28",
      label: "29 Jul – 28 Aug 2026",
    });
  });

  it("keeps the close day itself on the cycle it closes", () => {
    expect(cycleForDate("2026-08-28", 28)?.endDate).toBe("2026-08-28");
  });

  it("opens the next cycle the day after the close", () => {
    const cycle = cycleForDate("2026-08-29", 28);
    expect(cycle?.startDate).toBe("2026-08-29");
    expect(cycle?.endDate).toBe("2026-09-28");
  });

  it("rolls over the year when the cycle ends in January", () => {
    const cycle = cycleForDate("2025-12-30", 28);
    expect(cycle).toMatchObject({
      startDate: "2025-12-29",
      endDate: "2026-01-28",
      label: "29 Dec 2025 – 28 Jan 2026",
    });
  });

  it("rolls back the year when the cycle starts in December", () => {
    expect(cycleForDate("2026-01-05", 28)?.startDate).toBe("2025-12-29");
  });

  it("clamps a close day past the end of a short month", () => {
    // No 31st in February, so the statement closes on the 28th.
    const cycle = cycleForDate("2026-02-15", 31);
    expect(cycle?.endDate).toBe("2026-02-28");
    expect(cycle?.startDate).toBe("2026-02-01");
  });

  it("closes on the 29th in a leap February", () => {
    expect(cycleForDate("2028-02-15", 31)?.endDate).toBe("2028-02-29");
  });

  it("starts a March cycle on the 1st when February took the whole month", () => {
    // February closed on its last day, so there is no "day after" inside
    // February — March opens on the 1st rather than on a 29 Feb that may not
    // exist.
    const cycle = cycleForDate("2026-03-10", 31);
    expect(cycle?.startDate).toBe("2026-03-01");
    expect(cycle?.endDate).toBe("2026-03-31");
  });

  it("handles a close day of 1, where a cycle is one calendar month less a day", () => {
    const cycle = cycleForDate("2026-08-15", 1);
    expect(cycle?.startDate).toBe("2026-08-02");
    expect(cycle?.endDate).toBe("2026-09-01");
  });

  it("normalises an out-of-range close day instead of failing", () => {
    // 0 is what an account row predating migration 0070 could hold.
    expect(cycleForDate("2026-08-10", 0)).toEqual(cycleForDate("2026-08-10", 28));
  });

  it("returns undefined for a date that isn't YYYY-MM-DD", () => {
    expect(cycleForDate("", 28)).toBeUndefined();
    expect(cycleForDate("08/10/2026", 28)).toBeUndefined();
    expect(cycleForDate("2026-13-01", 28)).toBeUndefined();
    expect(cycleForDate("2026-02-30", 28)).toBeUndefined();
  });

  it("sorts chronologically by key as plain strings", () => {
    const keys = ["2026-08-10", "2025-12-30", "2026-01-05"]
      .map((date) => cycleForDate(date, 28)!.key)
      .sort();
    expect(keys).toEqual(["2026-01-28", "2026-01-28", "2026-08-28"]);
  });
});

describe("normalizeCloseDay", () => {
  it("passes a day in range through", () => {
    expect(normalizeCloseDay(1)).toBe(1);
    expect(normalizeCloseDay(31)).toBe(31);
  });

  it("falls back to the default outside 1–31 or for a non-integer", () => {
    expect(normalizeCloseDay(0)).toBe(DEFAULT_STATEMENT_CLOSE_DAY);
    expect(normalizeCloseDay(32)).toBe(DEFAULT_STATEMENT_CLOSE_DAY);
    expect(normalizeCloseDay(-5)).toBe(DEFAULT_STATEMENT_CLOSE_DAY);
    expect(normalizeCloseDay(15.5)).toBe(DEFAULT_STATEMENT_CLOSE_DAY);
  });
});

describe("cycleLabel", () => {
  it("prints the year once when the period stays inside one", () => {
    expect(cycleLabel("2026-07-29", "2026-08-28")).toBe("29 Jul – 28 Aug 2026");
  });

  it("prints both years when the period spans a new year", () => {
    expect(cycleLabel("2025-12-29", "2026-01-28")).toBe("29 Dec 2025 – 28 Jan 2026");
  });

  it("falls back to the raw dates when one isn't parseable", () => {
    expect(cycleLabel("nope", "2026-08-28")).toBe("nope – 2026-08-28");
  });
});
