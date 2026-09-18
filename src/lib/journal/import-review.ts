// "Am I about to write on top of something?" — the check behind the Journal
// module's `reviewBeforeCalendarImport` preference.
//
// The importer in ./ics-import.ts already answers a *different* question: it
// matches each event on its UID, so it knows whether that very event was
// imported before and refreshes it in place. What a UID cannot tell it is
// whether the reader wrote an entry of their own on the same day. That is what
// this asks, per date, before anything is written.
//
// Pure over the repository, like every other use-case here: `buildIcsImportReview`
// reads, `applyIcsReviewDecision` is a plain function over indexes. The web
// action and the CLI both drive them unchanged.

import { ICS_SOURCE, readIcsFile } from "./ics-import";
import type { JournalRepository } from "./ports";
import type {
  IcsEvent,
  IcsImportFilter,
  IcsImportReview,
  IcsImportReviewEntry,
  IcsImportReviewGroup,
  JournalEntry,
} from "./types";

/**
 * How much of an existing entry's content the review carries.
 *
 * A calendar import can touch dozens of dates, and a journal entry can run to
 * pages — sending every one whole would make the dialog unscannable and the
 * payload large. The reader gets enough to recognise the entry; the dialog links
 * to the entry itself for the rest.
 */
export const REVIEW_CONTENT_LIMIT = 200;

/** Shortens `content` to the limit on a word boundary where one is close enough. */
function excerptContent(content: string): { content: string; isContentTruncated: boolean } {
  const collapsed = content.trim();
  if (collapsed.length <= REVIEW_CONTENT_LIMIT) {
    return { content: collapsed, isContentTruncated: false };
  }

  const cut = collapsed.slice(0, REVIEW_CONTENT_LIMIT);
  // Break at the last space when there is one in the final quarter, so the
  // excerpt doesn't end mid-word. A long unbroken string (a URL) has none, and
  // is simply cut.
  const lastSpace = cut.lastIndexOf(" ");
  const kept = lastSpace > REVIEW_CONTENT_LIMIT * 0.75 ? cut.slice(0, lastSpace) : cut;

  return { content: kept.trimEnd(), isContentTruncated: true };
}

/** One stored entry, reduced to what the review dialog reads out. */
function toReviewEntry(entry: JournalEntry): IcsImportReviewEntry {
  const { content, isContentTruncated } = excerptContent(entry.content);
  return {
    id: entry.id,
    time: entry.time,
    title: entry.title,
    content,
    isContentTruncated,
    // Says "this one came from a calendar too", which is the difference between
    // a clash worth stopping for and a re-import of the reader's own earlier run.
    isFromCalendar: entry.source === ICS_SOURCE,
  };
}

/** The distinct dates the given events fall on, in ascending order. */
function distinctDates(events: IcsEvent[]): string[] {
  const dates = new Set<string>();
  for (const event of events) {
    if (event.date !== "") dates.add(event.date);
  }
  // ISO dates sort lexicographically, which is why the column stores them that
  // way (0027) — no parsing needed.
  return [...dates].sort();
}

/**
 * Looks up what the journal already holds on each date the selected events would
 * import into, and reports only the dates that hold something.
 *
 * `selectedIndexes` are positions in `events` — the same indexes the selection
 * grid ticks and the importer consumes, so the review and the import provably
 * talk about the same rows. Omitted means every event.
 *
 * A date with no existing entry is *not* reported: there is no decision to make
 * there, and listing it would bury the dates that matter. The counts say how
 * many such dates and events went through unreviewed.
 */
export function buildIcsImportReview(
  repo: JournalRepository,
  events: IcsEvent[],
  selectedIndexes?: number[],
): IcsImportReview {
  const selected = selectedIndexes ? new Set(selectedIndexes) : undefined;
  const chosen = events.filter(
    (event, index) => (selected ? selected.has(index) : true) && event.date !== "",
  );

  const dates = distinctDates(chosen);
  const groups: IcsImportReviewGroup[] = [];
  let unaffectedEventCount = 0;

  for (const date of dates) {
    const eventsOnDate = chosen.filter((event) => event.date === date);
    // One date is a one-day range. Using the existing range reader rather than
    // adding a by-date port method: the query is indexed either way, and a
    // second way to ask the same question is a second thing to keep in step.
    const existing = repo.listEntriesInDateRange(date, date);

    if (existing.length === 0) {
      unaffectedEventCount += eventsOnDate.length;
      continue;
    }

    groups.push({
      date,
      existingEntries: existing.map(toReviewEntry),
      selectedEventCount: eventsOnDate.length,
      selectedEventTitles: eventsOnDate.map((event) => event.summary),
    });
  }

  return { groups, totalDateCount: dates.length, unaffectedEventCount };
}

/**
 * Parses a file, applies the wizard's filter, and reviews the ticked rows — the
 * one call the web action and the CLI both make.
 *
 * The filter has to be the same one the preview was built with, for the reason
 * the import action explains: the ticked indexes are positions in the *filtered*
 * list, so a different filter would point them at different events.
 */
export function reviewIcsFile(
  repo: JournalRepository,
  fileText: string,
  filter: IcsImportFilter,
  selectedIndexes?: number[],
): IcsImportReview {
  const { events } = readIcsFile(fileText, filter);
  return buildIcsImportReview(repo, events, selectedIndexes);
}

/**
 * Drops every selected event falling on a date the reader said no to.
 *
 * Returns the surviving indexes, which go to `importIcsEvents` unchanged — the
 * decision is enforced by narrowing the selection, not by a second code path
 * inside the importer, so a "don't import" date cannot be written by some route
 * that forgot to check.
 *
 * Unknown dates in `excludedDates` are ignored: the reader answered a dialog
 * built from a snapshot, and a date that is no longer in the selection needs no
 * action.
 */
export function applyIcsReviewDecision(
  events: IcsEvent[],
  selectedIndexes: number[],
  excludedDates: string[],
): number[] {
  if (excludedDates.length === 0) return selectedIndexes;

  const excluded = new Set(excludedDates);
  return selectedIndexes.filter((index) => {
    const event = events[index];
    // An index with no event is left in rather than silently dropped — the
    // importer already reports an out-of-range tick, and swallowing it here
    // would hide a real mismatch between the preview and the import.
    if (!event) return true;
    return !excluded.has(event.date);
  });
}

/**
 * The same decision applied to a file rather than to a parsed list — what the
 * import action calls after the reader answers.
 *
 * Re-parses with the given filter for the reason above: the indexes are
 * positions in the filtered list, and parsing is deterministic, so re-deriving
 * it here yields the same order the reader ticked.
 */
export function applyIcsReviewDecisionToFile(
  fileText: string,
  filter: IcsImportFilter,
  selectedIndexes: number[],
  excludedDates: string[],
): number[] {
  const { events } = readIcsFile(fileText, filter);
  return applyIcsReviewDecision(events, selectedIndexes, excludedDates);
}
