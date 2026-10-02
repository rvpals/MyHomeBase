// Grouping journal entries that share a calendar date, for the Review Data section.
//
// Deliberately a *different question* from `duplicates.ts`, which groups on
// date + title. This one ignores the title entirely and groups on the date alone
// (and ignores the time within the date): the thing the reader is reviewing here
// is "I wrote four separate entries on the 14th — should some of those be one
// entry?", which is a question about the day, not about a repeated headline.
//
// Two consequences follow from that, and both are the opposite of what
// `duplicates.ts` chose:
//
//  - **Untitled entries are kept.** `findDuplicateGroups` skips them, because a
//    day with three untitled entries would present as a title-duplicate group on
//    the strength of having no title at all. Here there is no such false signal —
//    an untitled entry sitting on a crowded date is exactly the thing most worth
//    merging away, so dropping it would hide the best candidate.
//  - **Nothing here is called a duplicate.** Entries sharing a date are normal.
//    This module *lists* them; only the reader decides whether any of them are
//    redundant.
//
// As with duplicates, this module never decides what to delete or merge. It
// produces candidates; the delete path takes the ticked ids and the merge path
// takes the ticked entries, neither re-checking that they shared a date at all.

import { excerptWords } from "./duplicates";
import { isLogEntry } from "./journal";
import type { JournalEntry } from "./types";

/**
 * How many words of an entry's content a Review Data row shows.
 *
 * The same 100 as the Duplicates card. The request asked for "maybe the first
 * 500 words" and 100 was chosen instead: 500 words is several paragraphs, which
 * at grid-row height is neither readable nor skimmable, and the row click opens
 * the whole entry anyway. Kept as its own constant rather than importing
 * `DUPLICATE_EXCERPT_WORDS` so the two screens can diverge later without one
 * silently changing the other.
 */
export const SAME_DATE_EXCERPT_WORDS = 100;

/** One entry inside a same-date group, trimmed to what the list renders. */
export interface SameDateEntry {
  id: number;
  date: string;
  time: string;
  title: string;
  /** First `SAME_DATE_EXCERPT_WORDS` words of the content, "…"-suffixed if cut. */
  excerpt: string;
  isLocked: boolean;
  isPinned: boolean;
  createdAt: string;
}

/** Entries sharing one calendar date. Always 2 or more members. */
export interface SameDateGroup {
  date: string;
  entries: SameDateEntry[];
}

/** How `findSameDateGroups` narrows the population before it groups. */
export interface FindSameDateGroupsOptions {
  /**
   * Consider only Log entries — the card's "Review only Log entries" toggle.
   *
   * **Filters before grouping, not after.** A date qualifies only when it holds
   * two or more *Log* entries; one Log entry sitting beside two written ones is
   * not a pile of logged activities and does not appear. Filtering after the
   * grouping would instead mean "dates that have several entries, of which some
   * are logs", which answers a different question and would show single-Log
   * dates as "1 of 1".
   *
   * Log-ness is `isLogEntry` — the Log *category*, matched case-insensitively.
   * Deliberately the in-memory predicate rather than the exact-match SQL path
   * (`listLogEntries`): this screen already holds every entry in memory to group
   * it, so re-querying would be a second read of the same rows, and the looser
   * match is the safer error here — a hand-typed "log" entry belongs in a pile
   * of logged activities.
   */
  logOnly?: boolean;
}

/**
 * Groups `entries` by their calendar date, keeping only the dates carrying more
 * than one entry.
 *
 * Groups come back newest date first; within a group, entries are ordered by
 * time then id, so the day reads in the order it was lived and "merge these in
 * order" produces a chronological entry.
 *
 * The date is compared as stored — it is a validated YYYY-MM-DD, so there is no
 * variance to normalize away, and a string compare is also the correct
 * chronological sort.
 */
export function findSameDateGroups(
  entries: JournalEntry[],
  options: FindSameDateGroupsOptions = {},
): SameDateGroup[] {
  // Narrowed *before* grouping, not after, so the "2 or more" test counts only
  // the population being asked about. See FindSameDateGroupsOptions.logOnly for
  // why that is the meaningful reading of the question.
  const population = options.logOnly ? entries.filter(isLogEntry) : entries;

  const grouped = new Map<string, JournalEntry[]>();

  for (const entry of population) {
    const existing = grouped.get(entry.date) ?? [];
    existing.push(entry);
    grouped.set(entry.date, existing);
  }

  const groups: SameDateGroup[] = [];
  for (const [date, members] of grouped) {
    if (members.length < 2) continue;

    const ordered = [...members].sort(
      (left, right) => left.time.localeCompare(right.time) || left.id - right.id,
    );

    groups.push({
      date,
      entries: ordered.map((entry) => ({
        id: entry.id,
        date: entry.date,
        time: entry.time,
        title: entry.title,
        excerpt: excerptWords(entry.content, SAME_DATE_EXCERPT_WORDS),
        isLocked: entry.isLocked,
        isPinned: entry.isPinned,
        createdAt: entry.createdAt,
      })),
    });
  }

  return groups.sort((left, right) => right.date.localeCompare(left.date));
}

/** Total entries across every group — what the card's header count reports. */
export function countSameDateEntries(groups: SameDateGroup[]): number {
  return groups.reduce((total, group) => total + group.entries.length, 0);
}

/**
 * One row of the Review Data grid: a member entry with its group's identity
 * denormalized onto it.
 *
 * Same shape of trade as `DuplicateRow`. The grid is a flat, sortable, paginated
 * list rather than nested boxes, so the grouping has to travel on the row
 * itself: every row of one date carries the same `date`, so sorting by it puts
 * the day back together, and it is the grid's default sort. `entryIndex` /
 * `entryCount` say "2 of 4", which is what you need when deciding which of a
 * day's entries to tick.
 */
export interface SameDateRow extends SameDateEntry {
  entryIndex: number;
  entryCount: number;
}

/** Flattens groups into grid rows, preserving date and within-date order. */
export function toSameDateRows(groups: SameDateGroup[]): SameDateRow[] {
  const rows: SameDateRow[] = [];
  for (const group of groups) {
    group.entries.forEach((item, index) => {
      rows.push({ ...item, entryIndex: index + 1, entryCount: group.entries.length });
    });
  }
  return rows;
}

// --- Merging ----------------------------------------------------------------

/** How a merged entry's fields separate one source entry from the next. */
const MERGE_BLOCK_SEPARATOR = "\n\n";

/** Joins the source titles into the merged entry's title. */
const MERGE_TITLE_SEPARATOR = " / ";

/**
 * The draft a merge produces — the values the New Entry form is seeded with.
 *
 * Deliberately *not* an entry and deliberately not written anywhere: merging is
 * non-destructive here. This builds a proposal, the reader edits it in the
 * normal entry form, and saving it creates one new entry while every source
 * entry stays exactly where it was. Removing the originals is then a separate,
 * explicit Delete — so a merge abandoned half way through cannot lose writing.
 */
export interface MergedEntryDraft {
  date: string;
  time: string;
  title: string;
  content: string;
  placeName: string;
  categories: string[];
  tags: string[];
}

/**
 * Orders the entries a merge was asked for: by date, then time, then id.
 *
 * Sorted here rather than trusting the caller's selection order, because the
 * grid hands back whatever order the rows were ticked in and a merged entry
 * whose paragraphs run backwards through the day is not what anyone meant. Date
 * is included even though the screen groups by date: nothing stops a reader
 * ticking rows from two different days, and the merge should still read
 * chronologically if they do.
 */
function inReadingOrder(entries: JournalEntry[]): JournalEntry[] {
  return [...entries].sort(
    (left, right) =>
      left.date.localeCompare(right.date) || left.time.localeCompare(right.time) || left.id - right.id,
  );
}

/**
 * Case-insensitive de-duplicating union, preserving first-seen order.
 *
 * Merging four entries that all carry FAMILY should produce one FAMILY, not
 * four. Matching case-insensitively because the taxonomy is registered by name
 * and "family" and "FAMILY" are the same category to a reader even where the
 * store has both.
 */
function unionNames(lists: string[][]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const list of lists) {
    for (const name of list) {
      const trimmed = name.trim();
      if (trimmed === "") continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(trimmed);
    }
  }
  return merged;
}

/** The provenance header written above each source entry's content. */
function blockHeading(entry: JournalEntry): string {
  const title = entry.title.trim();
  const time = entry.time.trim();
  if (time !== "" && title !== "") return `— ${time} · ${title}`;
  if (time !== "") return `— ${time}`;
  if (title !== "") return `— ${title}`;
  return "—";
}

/**
 * Builds the merged draft from the selected entries.
 *
 * The rules, all of them chosen so the result is reviewable rather than clever:
 *
 *  - **Date and time** come from the earliest entry, so the merged entry files
 *    under the start of what it describes.
 *  - **Title** is the source titles joined with " / ", skipping untitled ones
 *    and repeats. If nothing had a title, the title comes back empty — the form
 *    will show it blank and the reader types one.
 *  - **Content** is each source's content in reading order, each preceded by a
 *    `— HH:MM · Title` line, so after the merge you can still see which
 *    paragraph came from which entry. A source with empty content contributes
 *    its heading only, which is the honest record of "there was an entry here
 *    and it said nothing".
 *  - **Place name** is the first non-empty one. Joining several places into one
 *    free-text field would produce a string that means nothing to the weather
 *    lookup or to a later reader.
 *  - **Categories and tags** are the union across sources.
 *
 * Locations and weather are deliberately not carried over: both belong to a
 * specific point in a specific entry, and a merged entry covering four moments
 * of a day has no single one of either. The form lets the reader add them.
 *
 * Returns an empty draft for an empty selection rather than throwing — the
 * caller is a UI whose Merge button is disabled at zero selection, so an empty
 * list here means a race, not a bug worth crashing a screen over.
 */
export function mergeEntryDraft(entries: JournalEntry[]): MergedEntryDraft {
  const ordered = inReadingOrder(entries);
  if (ordered.length === 0) {
    return { date: "", time: "", title: "", content: "", placeName: "", categories: [], tags: [] };
  }

  const titles: string[] = [];
  const seenTitles = new Set<string>();
  for (const entry of ordered) {
    const title = entry.title.trim();
    if (title === "") continue;
    const key = title.toLowerCase();
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);
    titles.push(title);
  }

  const blocks = ordered.map((entry) => {
    const content = entry.content.trim();
    return content === "" ? blockHeading(entry) : `${blockHeading(entry)}\n${content}`;
  });

  return {
    date: ordered[0].date,
    time: ordered[0].time,
    title: titles.join(MERGE_TITLE_SEPARATOR),
    content: blocks.join(MERGE_BLOCK_SEPARATOR),
    placeName: ordered.find((entry) => entry.placeName.trim() !== "")?.placeName.trim() ?? "",
    categories: unionNames(ordered.map((entry) => entry.categories)),
    tags: unionNames(ordered.map((entry) => entry.tags)),
  };
}
