// Finding duplicate journal entries for the Duplicate entries section.
//
// A duplicate here is "same calendar date + same title", and deliberately NOT
// the importer's date+time+title key (see `countEntriesMatching`). Two entries
// written at 09:00 and 21:00 on the same day under the same title are the thing
// this screen exists to surface: the importer was right to let both in, and only
// a human reading them can say whether one is redundant.
//
// So this module *finds candidates*. It never decides what to delete — the user
// ticks boxes, and the delete path takes the ticked ids without re-checking that
// they were duplicates at all.

import type { JournalEntry } from "./types";

/**
 * The default cut for `excerptWords` below.
 *
 * The Duplicates grid no longer shows an excerpt — its rows carry whole entries
 * with `content` blanked — so this is now only the default for `excerptWords`,
 * which the Review Data screen calls with its own narrower limit. Kept at 100
 * rather than retired because the constant is exported and the name is the
 * documented default.
 */
export const DUPLICATE_EXCERPT_WORDS = 100;

/**
 * Entries sharing one date+title. Always 2 or more members.
 *
 * The members are **whole `JournalEntry` objects with `content` blanked**, not a
 * trimmed shape of their own. That is what lets the Duplicate entries section
 * show the same columns as the List of Entries — Date, Time, Title, Categories,
 * Tags — and run the same bulk actions over them: both read a `JournalEntry`,
 * and a reduced shape would have meant a second column set and a second action
 * bar. That is exactly how the Log tab drifted from the Entries grid before it
 * was folded back in — see the docblock at the top of journal-entries-view.tsx.
 *
 * `content` is the one field dropped. Duplicate detection is a whole-journal
 * question (see `findDuplicateGroups`), so this list is unbounded — shipping
 * every body would be the bulk of the payload, and no column renders it. The
 * grid's row click fetches the whole entry instead (`getJournalEntryAction`).
 * It is blanked rather than silently truncated, so nothing can mistake it for
 * the entry's real text; re-adding a content column means putting an excerpt
 * field back on the row, not reading `content`.
 */
export interface DuplicateGroup {
  date: string;
  title: string;
  entries: JournalEntry[];
}

/**
 * Cuts `content` to its first `maxWords` words.
 *
 * Used by the Review Data screen (src/lib/journal/same-date.ts), which does show
 * an excerpt. The Duplicates grid does not.
 *
 * Splits on any whitespace run so newlines and tabs count as separators — a
 * journal entry is mostly prose with hard line breaks, and splitting on " "
 * alone would count a whole paragraph as one word. The ellipsis is only added
 * when something was actually removed, so a short entry doesn't look truncated.
 */
export function excerptWords(content: string, maxWords: number = DUPLICATE_EXCERPT_WORDS): string {
  const words = content.trim().split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return "";
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ")}…`;
}

/**
 * The grouping key. Title is trimmed and compared case-insensitively:
 * "Morning run" and "morning run " are the same entry typed twice, which is
 * exactly the mistake this screen is looking for. Date is compared as stored —
 * it is a validated YYYY-MM-DD, so there is no variance to normalize away.
 *
 * Case-insensitivity is the one place this is *looser* than the importer's key,
 * which treats a re-titled entry as a different entry. Different jobs: the
 * importer must not overwrite, this screen must not hide.
 */
function groupKey(entry: JournalEntry): string {
  return `${entry.date}\u0000${entry.title.trim().toLowerCase()}`;
}

/**
 * Groups `entries` into sets sharing a date and title, keeping only the sets
 * with more than one member.
 *
 * Groups come back newest date first; within a group, entries are ordered by
 * time then id, so the oldest-written copy of a pair reads first and "keep the
 * first, delete the rest" is a coherent thing for the user to do by eye.
 *
 * Untitled entries are skipped entirely. `title` defaults to '' in the schema,
 * so a day with three untitled entries would otherwise present as a duplicate
 * group on the strength of having no title at all — noise, not a finding.
 */
export function findDuplicateGroups(entries: JournalEntry[]): DuplicateGroup[] {
  const grouped = new Map<string, JournalEntry[]>();

  for (const entry of entries) {
    // Encrypted entries are skipped for the same reason untitled ones are: their
    // title column is blank (migration 0131), so three encrypted entries on one
    // date would present as a duplicate group on the strength of having no
    // readable title at all. That is noise, not a finding — and unlike an
    // untitled entry, nothing here could ever tell whether they really match.
    if (entry.isEncrypted) continue;
    if (entry.title.trim() === "") continue;
    const key = groupKey(entry);
    const existing = grouped.get(key) ?? [];
    existing.push(entry);
    grouped.set(key, existing);
  }

  const groups: DuplicateGroup[] = [];
  for (const members of grouped.values()) {
    if (members.length < 2) continue;

    const ordered = [...members].sort(
      (left, right) => left.time.localeCompare(right.time) || left.id - right.id,
    );

    groups.push({
      date: ordered[0].date,
      // The first member's title, not the lowercased key: the list should show
      // the text as the user typed it, not a normalized version of it.
      title: ordered[0].title.trim(),
      // The whole entry, minus its body — see the note on `DuplicateGroup`.
      // Spread rather than field-by-field so a column added to the shared entry
      // grid works here without a second edit in this file.
      entries: ordered.map((entry) => ({ ...entry, content: "" })),
    });
  }

  return groups.sort(
    (left, right) => right.date.localeCompare(left.date) || left.title.localeCompare(right.title),
  );
}

/** Total entries across every group — what the card's header count reports. */
export function countDuplicateEntries(groups: DuplicateGroup[]): number {
  return groups.reduce((total, group) => total + group.entries.length, 0);
}

/**
 * One row of the Duplicates grid: a member entry with its group's identity
 * denormalized onto it.
 *
 * A `JournalEntry` **plus** four fields rather than a shape of its own, so the
 * row feeds the same column set and the same bulk actions as the List of
 * Entries — see the note on `DuplicateGroup` for why that matters. `content` is
 * blank on every row.
 *
 * The grid is a flat, sortable, paginated list rather than nested boxes, so the
 * grouping has to travel on the row itself. `groupKey` is what keeps the
 * grouping legible after the user sorts by another column — every row of one
 * duplicate set carries the same value, so sorting by it puts them back
 * together, and it is the grid's default sort.
 *
 * `copyIndex` / `copyCount` say "2 of 3", which is what you actually need when
 * deciding which copy to keep and which to tick.
 */
export interface DuplicateRow extends JournalEntry {
  groupKey: string;
  groupTitle: string;
  copyIndex: number;
  copyCount: number;
}

/** Flattens groups into grid rows, preserving group and within-group order. */
export function toDuplicateRows(groups: DuplicateGroup[]): DuplicateRow[] {
  const rows: DuplicateRow[] = [];
  for (const group of groups) {
    const groupKey = `${group.date} · ${group.title}`;
    group.entries.forEach((item, index) => {
      rows.push({
        ...item,
        groupKey,
        groupTitle: group.title,
        copyIndex: index + 1,
        copyCount: group.entries.length,
      });
    });
  }
  return rows;
}
