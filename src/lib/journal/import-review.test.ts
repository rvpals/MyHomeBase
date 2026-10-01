import { describe, expect, it } from "vitest";
import {
  REVIEW_CONTENT_LIMIT,
  applyIcsReviewDecision,
  applyIcsReviewDecisionToFile,
  buildIcsImportReview,
  icsReviewIndexesForDates,
  reviewIcsFile,
} from "./import-review";
import { ICS_SOURCE } from "./ics-import";
import type { JournalRepository } from "./ports";
import type { IcsEvent, IcsImportFilter, JournalEntry } from "./types";

// The port methods the review reads. Named explicitly so the fake's parameters
// stay typed — the same reason ics-import.test.ts does it.
type ReviewRepo = Pick<JournalRepository, "listEntriesInDateRange" | "findEntryIdsBySource">;

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
 * An in-memory repository over a fixed entry list. Only the two reads
 * `buildIcsImportReview` touches are implemented; `calls` records the ranges
 * asked for, so a test can prove one query per date rather than a scan.
 *
 * `findEntryIdsBySource` answers from the same entry list, so an entry given a
 * `source`/`externalId` in a test is found by a matching event's UID — which is
 * what makes `willRefresh` testable without a second fixture.
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
    findEntryIdsBySource(source, externalId) {
      return entries
        .filter(
          (candidate) => candidate.source === source && candidate.externalId === externalId,
        )
        .map((candidate) => candidate.id);
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

  it("carries an existing entry's lock state, so the dialog can refuse to edit it", () => {
    // The quick-edit disables itself on a locked entry rather than offering an
    // edit `updateEntry` would throw on.
    const { repo } = fakeRepo([
      entry({ id: 1, date: "2026-03-14", title: "Locked", isLocked: true }),
      entry({ id: 2, date: "2026-03-14", title: "Open", time: "10:00" }),
    ]);

    const review = buildIcsImportReview(repo, [event({ date: "2026-03-14" })]);

    expect(
      review.groups[0].existingEntries.map((existing) => [existing.title, existing.isLocked]),
    ).toEqual([
      ["Locked", true],
      ["Open", false],
    ]);
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

describe("the incoming side of a review group", () => {
  it("carries each selected event's own fields, not just its title", () => {
    const { repo } = fakeRepo([entry({ id: 1, date: "2026-03-14", title: "Wrote by hand" })]);

    const review = buildIcsImportReview(repo, [
      event({
        date: "2026-03-14",
        summary: "Swim practice",
        description: "Lane 4, warm up first",
        location: "Community pool",
        time: "18:30",
      }),
    ]);

    expect(review.groups[0].incomingEvents).toEqual([
      {
        eventIndex: 0,
        time: "18:30",
        isAllDay: false,
        title: "Swim practice",
        content: "Lane 4, warm up first",
        isContentTruncated: false,
        location: "Community pool",
        willRefresh: false,
      },
    ]);
  });

  it("excerpts a long description the same way the existing side is excerpted", () => {
    const { repo } = fakeRepo([entry({ id: 1, date: "2026-03-14" })]);
    const long = "word ".repeat(200).trim();

    const review = buildIcsImportReview(repo, [
      event({ date: "2026-03-14", description: long }),
    ]);

    const incoming = review.groups[0].incomingEvents[0];
    expect(incoming.isContentTruncated).toBe(true);
    expect(incoming.content.length).toBeLessThanOrEqual(REVIEW_CONTENT_LIMIT);
  });

  it("marks an event whose UID is already imported as a refresh", () => {
    // The clash the reader should worry about least: this event is their own
    // earlier import coming back, so importing updates it in place.
    const { repo } = fakeRepo([
      entry({
        id: 1,
        date: "2026-03-14",
        title: "Swim practice",
        source: ICS_SOURCE,
        externalId: "uid-1",
      }),
    ]);

    const review = buildIcsImportReview(repo, [
      event({ date: "2026-03-14", uid: "uid-1", summary: "Swim practice" }),
    ]);

    expect(review.groups[0].incomingEvents[0].willRefresh).toBe(true);
  });

  it("marks an event with an unseen UID as a new entry", () => {
    const { repo } = fakeRepo([
      entry({
        id: 1,
        date: "2026-03-14",
        source: ICS_SOURCE,
        externalId: "some-other-uid",
      }),
    ]);

    const review = buildIcsImportReview(repo, [event({ date: "2026-03-14", uid: "uid-1" })]);

    expect(review.groups[0].incomingEvents[0].willRefresh).toBe(false);
  });

  it("never claims a refresh for an event with no UID", () => {
    // No UID means no identity to match, so the importer can only create it --
    // saying otherwise would promise something the import won't do.
    const { repo } = fakeRepo([
      entry({ id: 1, date: "2026-03-14", source: ICS_SOURCE, externalId: "" }),
    ]);

    const review = buildIcsImportReview(repo, [event({ date: "2026-03-14", uid: "   " })]);

    expect(review.groups[0].incomingEvents[0].willRefresh).toBe(false);
  });

  it("indexes each event by its position in the filtered list, not within the date", () => {
    // The dialog's indexes have to line up with the ticks the grid made, so an
    // event on the second reviewed date keeps its original position.
    const { repo } = fakeRepo([
      entry({ id: 1, date: "2026-03-14" }),
      entry({ id: 2, date: "2026-03-16" }),
    ]);

    const review = buildIcsImportReview(repo, [
      event({ date: "2026-03-14", uid: "uid-1" }),
      event({ date: "2026-03-15", uid: "uid-2" }),
      event({ date: "2026-03-16", uid: "uid-3" }),
    ]);

    expect(review.groups.map((group) => group.incomingEvents.map((e) => e.eventIndex))).toEqual([
      [0],
      [2],
    ]);
  });

  it("keeps the ticked indexes when only part of the file is selected", () => {
    const { repo } = fakeRepo([entry({ id: 1, date: "2026-03-14" })]);

    const review = buildIcsImportReview(
      repo,
      [
        event({ date: "2026-03-14", uid: "uid-1", summary: "Skipped" }),
        event({ date: "2026-03-14", uid: "uid-2", summary: "Ticked" }),
      ],
      [1],
    );

    expect(review.groups[0].incomingEvents).toHaveLength(1);
    expect(review.groups[0].incomingEvents[0].eventIndex).toBe(1);
    expect(review.groups[0].incomingEvents[0].title).toBe("Ticked");
  });

  it("carries an all-day event with no time", () => {
    const { repo } = fakeRepo([entry({ id: 1, date: "2026-03-14" })]);

    const review = buildIcsImportReview(repo, [
      event({ date: "2026-03-14", time: "", isAllDay: true, summary: "Public holiday" }),
    ]);

    expect(review.groups[0].incomingEvents[0]).toMatchObject({
      time: "",
      isAllDay: true,
      title: "Public holiday",
    });
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

describe("icsReviewIndexesForDates", () => {
  // Built the way the dialog receives them, so these read against the real shape.
  function reviewGroups(): ReturnType<typeof buildIcsImportReview>["groups"] {
    const { repo } = fakeRepo([
      entry({ id: 1, date: "2026-03-14" }),
      entry({ id: 2, date: "2026-03-16" }),
      entry({ id: 3, date: "2026-03-18" }),
    ]);

    return buildIcsImportReview(repo, [
      event({ date: "2026-03-14", uid: "uid-1" }), // index 0
      event({ date: "2026-03-15", uid: "uid-2" }), // index 1 — no existing entry
      event({ date: "2026-03-16", uid: "uid-3" }), // index 2
      event({ date: "2026-03-16", uid: "uid-4" }), // index 3 — same date
      event({ date: "2026-03-18", uid: "uid-5" }), // index 4
    ]).groups;
  }

  it("returns the indexes of every event on the decided dates", () => {
    expect(icsReviewIndexesForDates(reviewGroups(), ["2026-03-16"])).toEqual([2, 3]);
  });

  it("gathers several dates, ascending, whatever order they were decided in", () => {
    // The reader may have answered the third date before the first.
    expect(icsReviewIndexesForDates(reviewGroups(), ["2026-03-18", "2026-03-14"])).toEqual([
      0, 4,
    ]);
  });

  it("returns nothing when no date has been decided", () => {
    expect(icsReviewIndexesForDates(reviewGroups(), [])).toEqual([]);
  });

  it("ignores a date that isn't in the review", () => {
    // A date already committed and dropped from the list, or one that never had
    // an existing entry to review in the first place.
    expect(icsReviewIndexesForDates(reviewGroups(), ["2026-03-15", "2026-01-01"])).toEqual([]);
  });

  it("does not duplicate an index if a date is listed twice", () => {
    expect(icsReviewIndexesForDates(reviewGroups(), ["2026-03-16", "2026-03-16"])).toEqual([
      2, 3,
    ]);
  });

  it("keeps indexes pointing at the filtered list, not at a per-date position", () => {
    // The whole point: index 4 is the fifth event in the file, not the first on
    // its own date. Committing 2026-03-18 must import that event and no other.
    expect(icsReviewIndexesForDates(reviewGroups(), ["2026-03-18"])).toEqual([4]);
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
