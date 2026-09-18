import { describe, expect, it } from "vitest";
import {
  REVIEW_CONTENT_LIMIT,
  applyIcsReviewDecision,
  applyIcsReviewDecisionToFile,
  buildIcsImportReview,
  reviewIcsFile,
} from "./import-review";
import { ICS_SOURCE } from "./ics-import";
import type { JournalRepository } from "./ports";
import type { IcsEvent, IcsImportFilter, JournalEntry } from "./types";

// The one port method the review reads. Named explicitly so the fake's
// parameters stay typed — the same reason ics-import.test.ts does it.
type ReviewRepo = Pick<JournalRepository, "listEntriesInDateRange">;

function entry(overrides: Partial<JournalEntry> & { id: number; date: string }): JournalEntry {
  return {
    time: "",
    title: "",
    content: "",
    placeName: "",
    isPinned: false,
    isLocked: false,
    categories: [],
    tags: [],
    locations: [],
    source: "",
    externalId: "",
    externalContent: "",
    createdAt: "2026-09-11 00:00:00",
    updatedAt: "2026-09-11 00:00:00",
    ...overrides,
  };
}

/**
 * An in-memory repository over a fixed entry list. Only the date-range read is
 * implemented, which is all `buildIcsImportReview` touches; `calls` records the
 * ranges asked for, so a test can prove one query per date rather than a scan.
 */
function fakeRepo(entries: JournalEntry[]): {
  repo: JournalRepository;
  calls: [string, string][];
} {
  const calls: [string, string][] = [];
  const repo: ReviewRepo = {
    listEntriesInDateRange(startDate, endDate) {
      calls.push([startDate, endDate]);
      return entries
        .filter((candidate) => candidate.date >= startDate && candidate.date <= endDate)
        .sort((left, right) => left.time.localeCompare(right.time));
    },
  };
  return { repo: repo as JournalRepository, calls };
}

function event(overrides: Partial<IcsEvent> & { date: string }): IcsEvent {
  return {
    uid: "uid-1",
    summary: "An event",
    description: "",
    location: "",
    time: "09:00",
    isAllDay: false,
    endDate: "",
    endTime: "",
    isRecurring: false,
    calendarName: "Personal",
    ...overrides,
  };
}

describe("buildIcsImportReview", () => {
  it("reports only the dates that already hold an entry", () => {
    const { repo } = fakeRepo([entry({ id: 1, date: "2026-03-14", title: "Wrote by hand" })]);

    const review = buildIcsImportReview(repo, [
      event({ date: "2026-03-14", summary: "Swim practice" }),
      event({ date: "2026-03-15", summary: "Dentist", uid: "uid-2" }),
    ]);

    expect(review.groups).toHaveLength(1);
    expect(review.groups[0].date).toBe("2026-03-14");
    expect(review.groups[0].existingEntries[0].title).toBe("Wrote by hand");
    // The clean date needed no decision, so it is counted rather than listed.
    expect(review.totalDateCount).toBe(2);
    expect(review.unaffectedEventCount).toBe(1);
  });

  it("returns no groups when the journal is empty on every date", () => {
    const { repo } = fakeRepo([]);

    const review = buildIcsImportReview(repo, [
      event({ date: "2026-03-14" }),
      event({ date: "2026-03-15", uid: "uid-2" }),
    ]);

    expect(review.groups).toEqual([]);
    expect(review.unaffectedEventCount).toBe(2);
  });

  it("counts every selected event on a reviewed date, and names them", () => {
    // What "don't import 2026-03-14" would drop — the dialog has to say how many.
    const { repo } = fakeRepo([entry({ id: 1, date: "2026-03-14" })]);

    const review = buildIcsImportReview(repo, [
      event({ date: "2026-03-14", summary: "Morning swim" }),
      event({ date: "2026-03-14", summary: "Evening swim", uid: "uid-2" }),
    ]);

    expect(review.groups[0].selectedEventCount).toBe(2);
    expect(review.groups[0].selectedEventTitles).toEqual(["Morning swim", "Evening swim"]);
  });

  it("honours the ticked selection rather than reviewing the whole file", () => {
    const { repo } = fakeRepo([
      entry({ id: 1, date: "2026-03-14" }),
      entry({ id: 2, date: "2026-03-15" }),
    ]);

    // Only index 0 is ticked, so the 15th is not part of this import at all and
    // must not be raised for review.
    const review = buildIcsImportReview(
      repo,
      [event({ date: "2026-03-14" }), event({ date: "2026-03-15", uid: "uid-2" })],
      [0],
    );

    expect(review.groups.map((group) => group.date)).toEqual(["2026-03-14"]);
    expect(review.totalDateCount).toBe(1);
  });

  it("asks for one single-day range per distinct date", () => {
    const { repo, calls } = fakeRepo([]);

    buildIcsImportReview(repo, [
      event({ date: "2026-03-14" }),
      event({ date: "2026-03-14", uid: "uid-2" }),
      event({ date: "2026-03-15", uid: "uid-3" }),
    ]);

    // Two dates, two queries — the duplicate date is not asked twice, and
    // neither is a wide range read and filtered in memory.
    expect(calls).toEqual([
      ["2026-03-14", "2026-03-14"],
      ["2026-03-15", "2026-03-15"],
    ]);
  });

  it("skips an event with no usable date instead of querying for it", () => {
    // A VEVENT with no DTSTART reaches here as date "". Passing it to the range
    // reader would throw — it validates YYYY-MM-DD.
    const { repo, calls } = fakeRepo([]);

    const review = buildIcsImportReview(repo, [event({ date: "" })]);

    expect(review.groups).toEqual([]);
    expect(review.totalDateCount).toBe(0);
    expect(calls).toEqual([]);
  });

  it("marks an existing entry that came from a calendar import", () => {
    const { repo } = fakeRepo([
      entry({ id: 1, date: "2026-03-14", source: ICS_SOURCE, externalId: "uid-1" }),
      entry({ id: 2, date: "2026-03-14", source: "", time: "10:00" }),
    ]);

    const review = buildIcsImportReview(repo, [event({ date: "2026-03-14" })]);

    expect(review.groups[0].existingEntries.map((row) => row.isFromCalendar)).toEqual([
      true,
      false,
    ]);
  });

  it("orders the groups by date", () => {
    const { repo } = fakeRepo([
      entry({ id: 1, date: "2026-03-14" }),
      entry({ id: 2, date: "2026-01-02" }),
    ]);

    const review = buildIcsImportReview(repo, [
      event({ date: "2026-03-14" }),
      event({ date: "2026-01-02", uid: "uid-2" }),
    ]);

    expect(review.groups.map((group) => group.date)).toEqual(["2026-01-02", "2026-03-14"]);
  });
});

describe("review excerpts", () => {
  it("passes short content through untouched", () => {
    const { repo } = fakeRepo([entry({ id: 1, date: "2026-03-14", content: "A short note." })]);

    const review = buildIcsImportReview(repo, [event({ date: "2026-03-14" })]);

    expect(review.groups[0].existingEntries[0].content).toBe("A short note.");
    expect(review.groups[0].existingEntries[0].isContentTruncated).toBe(false);
  });

  it("shortens long content at a word boundary and says that it did", () => {
    const { repo } = fakeRepo([
      entry({ id: 1, date: "2026-03-14", content: "word ".repeat(200).trim() }),
    ]);

    const review = buildIcsImportReview(repo, [event({ date: "2026-03-14" })]);
    const row = review.groups[0].existingEntries[0];

    expect(row.isContentTruncated).toBe(true);
    expect(row.content.length).toBeLessThanOrEqual(REVIEW_CONTENT_LIMIT);
    // Cut between words, not through one.
    expect(row.content.endsWith("word")).toBe(true);
  });

  it("cuts an unbroken string that offers no word boundary", () => {
    const { repo } = fakeRepo([entry({ id: 1, date: "2026-03-14", content: "x".repeat(500) })]);

    const review = buildIcsImportReview(repo, [event({ date: "2026-03-14" })]);
    const row = review.groups[0].existingEntries[0];

    expect(row.isContentTruncated).toBe(true);
    expect(row.content).toHaveLength(REVIEW_CONTENT_LIMIT);
  });
});

describe("applyIcsReviewDecision", () => {
  const events = [
    event({ date: "2026-03-14", summary: "Morning swim" }),
    event({ date: "2026-03-14", summary: "Evening swim", uid: "uid-2" }),
    event({ date: "2026-03-15", summary: "Dentist", uid: "uid-3" }),
  ];

  it("drops every selected event on an excluded date", () => {
    // The whole point of the per-date choice: both events on the 14th go.
    expect(applyIcsReviewDecision(events, [0, 1, 2], ["2026-03-14"])).toEqual([2]);
  });

  it("returns the selection unchanged when nothing was excluded", () => {
    expect(applyIcsReviewDecision(events, [0, 1, 2], [])).toEqual([0, 1, 2]);
  });

  it("can exclude every date, leaving nothing to import", () => {
    expect(applyIcsReviewDecision(events, [0, 1, 2], ["2026-03-14", "2026-03-15"])).toEqual([]);
  });

  it("ignores a date that is not in the selection", () => {
    expect(applyIcsReviewDecision(events, [0], ["2026-12-25"])).toEqual([0]);
  });

  it("keeps an out-of-range index rather than silently swallowing it", () => {
    // The importer already reports a tick it can't resolve. Dropping it here
    // would hide a real mismatch between the preview and the import.
    expect(applyIcsReviewDecision(events, [99], ["2026-03-14"])).toEqual([99]);
  });
});

// A two-event file, which is what the action actually receives.
const ICS_FILE = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "X-WR-CALNAME:Personal",
  "BEGIN:VEVENT",
  "UID:uid-1",
  "DTSTART:20260314T090000Z",
  "SUMMARY:Swim practice",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:uid-2",
  "DTSTART:20260315T090000Z",
  "SUMMARY:Dentist",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const NO_FILTER: IcsImportFilter = {};

describe("reviewIcsFile", () => {
  it("parses, filters and reviews in one call", () => {
    const { repo } = fakeRepo([entry({ id: 1, date: "2026-03-14", title: "Already here" })]);

    const review = reviewIcsFile(repo, ICS_FILE, NO_FILTER);

    expect(review.groups).toHaveLength(1);
    expect(review.groups[0].date).toBe("2026-03-14");
    expect(review.groups[0].existingEntries[0].title).toBe("Already here");
  });

  it("reviews against the filtered list, so indexes line up with the preview", () => {
    const { repo } = fakeRepo([
      entry({ id: 1, date: "2026-03-14" }),
      entry({ id: 2, date: "2026-03-15" }),
    ]);

    // The filter drops the 14th, so index 0 is now the 15th — the same shift the
    // preview grid made.
    const review = reviewIcsFile(repo, ICS_FILE, { fromDate: "2026-03-15" }, [0]);

    expect(review.groups.map((group) => group.date)).toEqual(["2026-03-15"]);
  });

  it("finds nothing to review against an empty journal", () => {
    const { repo } = fakeRepo([]);

    expect(reviewIcsFile(repo, ICS_FILE, NO_FILTER).groups).toEqual([]);
  });
});

describe("applyIcsReviewDecisionToFile", () => {
  it("re-derives the same list the reader ticked, then drops the excluded date", () => {
    expect(applyIcsReviewDecisionToFile(ICS_FILE, NO_FILTER, [0, 1], ["2026-03-14"])).toEqual([1]);
  });

  it("applies the decision against the filtered order, not the file order", () => {
    // Filtered to the 15th only, so index 0 is the Dentist event. Excluding the
    // 14th must therefore drop nothing.
    expect(
      applyIcsReviewDecisionToFile(ICS_FILE, { fromDate: "2026-03-15" }, [0], ["2026-03-14"]),
    ).toEqual([0]);

    expect(
      applyIcsReviewDecisionToFile(ICS_FILE, { fromDate: "2026-03-15" }, [0], ["2026-03-15"]),
    ).toEqual([]);
  });

  it("leaves the selection alone when no date was excluded", () => {
    expect(applyIcsReviewDecisionToFile(ICS_FILE, NO_FILTER, [0, 1], [])).toEqual([0, 1]);
  });
});
