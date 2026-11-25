// "What else did I write on this month and day, in any year?" — the question
// behind the Calendar's per-cell **Today in history** button.
//
// Deliberately a *different question* from `listTodayInHistory` in journal.ts,
// which backs the home screen's Today In History card. That one answers "what
// happened on today's date in earlier years", and narrows accordingly: it drops
// Log entries (an imported calendar would crowd a dashboard card out), drops the
// reference year itself, and drops anything later. This one narrows none of
// that, because the calendar cell's button is a question about the *square you
// pressed*: every entry filed under that month and day, this year's included,
// log entries included, oldest and newest alike. A reader who clicked the 24th
// and saw this year's entries missing from a list headed "In history on
// November 24" would reasonably call that a bug.
//
// Kept apart from journal.ts rather than folded in as an option flag, for the
// reason same-date.ts is kept apart from duplicates.ts: two screens asking
// near-identical questions with opposite narrowing is exactly the pair that a
// shared function with a boolean starts silently answering wrong.

import type { JournalRepository } from "./ports";
import type { JournalEntry } from "./types";

const ISO_DATE_PATTERN = /^\d{4}-(\d{2}-\d{2})$/;

/**
 * The "MM-DD" of an ISO date — the key the repository matches on.
 *
 * Exported because the caller needs it too: the dialog's refresh scope is keyed
 * by month-day rather than by the full date, so a write inside the dialog
 * re-reads the same question rather than one year's worth of it.
 */
export function monthDayOf(date: string): string {
  const match = ISO_DATE_PATTERN.exec(date);
  if (!match) {
    throw new Error(`monthDayOf: date must be YYYY-MM-DD, got "${date}".`);
  }
  return match[1];
}

/**
 * Every entry falling on the same month and day as `date`, in **any** year,
 * newest first.
 *
 * `content` is blanked on every row. Nothing in the grid these rows feed reads
 * the body — the columns are Date, Time, Title, Categories, Tags — and this
 * read is unbounded by design: an imported calendar can hold hundreds of routine
 * events on one date, so across twenty years the bodies would be the whole
 * payload for none of the benefit. The dialog fetches the one entry a reader
 * clicks, exactly as the Duplicates card does.
 */
export function listEntriesOnMonthDay(repo: JournalRepository, date: string): JournalEntry[] {
  return repo
    .listEntriesByMonthDay(monthDayOf(date))
    .map((entry) => ({ ...entry, content: "" }));
}

/**
 * The same list for a month-day that is already split out ("11-24").
 *
 * The refresh path after a bulk write has the month-day and no date to rebuild
 * it from, and inventing a year to hand back to `listEntriesOnMonthDay` would
 * mean inventing one that exists — February 29 has no safe choice.
 */
export function listEntriesOnMonthDayKey(
  repo: JournalRepository,
  monthDay: string,
): JournalEntry[] {
  if (!/^\d{2}-\d{2}$/.test(monthDay)) {
    throw new Error(`listEntriesOnMonthDayKey: monthDay must be MM-DD, got "${monthDay}".`);
  }
  return repo.listEntriesByMonthDay(monthDay).map((entry) => ({ ...entry, content: "" }));
}
