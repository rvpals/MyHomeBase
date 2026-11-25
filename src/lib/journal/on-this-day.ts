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

import { excerptWords } from "./duplicates";
import type { JournalRepository } from "./ports";
import type { JournalEntry } from "./types";

const ISO_DATE_PATTERN = /^\d{4}-(\d{2}-\d{2})$/;

/**
 * How many words of an entry's body the dialog's Content column shows.
 *
 * The same 100 as the Duplicates and Review Data screens, and — like
 * `SAME_DATE_EXCERPT_WORDS` — its own constant rather than an import of
 * `DUPLICATE_EXCERPT_WORDS`, so the three screens can diverge later without one
 * silently changing the others.
 */
export const ON_THIS_DAY_EXCERPT_WORDS = 100;

/**
 * One row in the Today in history dialog: a whole entry with its body replaced
 * by a short excerpt.
 *
 * A subtype of `JournalEntry` rather than a trimmed shape of its own, for the
 * reason `DuplicateRow` is one — it feeds `JournalEntriesGrid`, which reads a
 * `JournalEntry`, and a reduced shape would mean a second column set and a
 * second action bar. See the note on `DuplicateGroup` in duplicates.ts.
 *
 * **`content` is blanked and `excerpt` carries the first
 * `ON_THIS_DAY_EXCERPT_WORDS` words instead.** Blanked rather than truncated in
 * place, so nothing downstream can mistake the short text for the entry's real
 * body — a Merge or a Bulk overwrite reading `content` here would otherwise
 * write 100 words over the whole entry. The writes all re-read from the
 * repository by id, and the row click fetches the entry whole.
 */
export interface OnThisDayRow extends JournalEntry {
  /** First `ON_THIS_DAY_EXCERPT_WORDS` words of the body, "…"-suffixed if cut. */
  excerpt: string;
}

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
 * Excerpt first, then blank — the order matters, and reversing it would hand
 * every row an empty excerpt.
 *
 * An encrypted entry needs no special case: migration 0131 blanks `content` in
 * the row and keeps the ciphertext in `contentEncrypted`, which nothing here
 * reads, so its excerpt comes out empty on its own.
 */
function toRows(entries: JournalEntry[]): OnThisDayRow[] {
  return entries.map((entry) => ({
    ...entry,
    excerpt: excerptWords(entry.content, ON_THIS_DAY_EXCERPT_WORDS),
    content: "",
  }));
}

/**
 * Every entry falling on the same month and day as `date`, in **any** year,
 * newest first.
 *
 * The read is unbounded by design: an imported calendar can hold hundreds of
 * routine events on one date, so across twenty years the full bodies would be
 * the whole payload. What crosses the wire is one 100-word excerpt per row
 * instead.
 */
export function listEntriesOnMonthDay(repo: JournalRepository, date: string): OnThisDayRow[] {
  return toRows(repo.listEntriesByMonthDay(monthDayOf(date)));
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
): OnThisDayRow[] {
  if (!/^\d{2}-\d{2}$/.test(monthDay)) {
    throw new Error(`listEntriesOnMonthDayKey: monthDay must be MM-DD, got "${monthDay}".`);
  }
  return toRows(repo.listEntriesByMonthDay(monthDay));
}
