import type { JournalRepository } from "./ports";
import type { JournalEntry } from "./types";

/**
 * How many recently-edited entries the home card draws before it stops.
 *
 * Twice `PINNED_ENTRY_LIMIT`, deliberately: pinning is a shortlist somebody curates
 * by hand, while "what did I touch lately" is a recency feed and reads better with
 * more of it. Exported so the view can say "the last N" without re-deciding it.
 */
export const RECENTLY_EDITED_ENTRY_LIMIT = 20;

/**
 * The most recently edited entries, newest edit first, up to `limit`.
 *
 * Built on `findEntries` with an empty filter and an explicit sort, rather than a new
 * repository method — the same reasoning as `listPinnedEntries`. `updatedAt` is
 * already a `JournalSortField`, and an empty filter compiles to no WHERE at all
 * (see `findEntries`), so this is one indexed ORDER BY over `jrn_entries` and not a
 * second way to ask a question the filter engine can already answer.
 *
 * **An entry that has never been edited still appears**, because `updated_at` starts
 * life equal to `created_at`. That is intended: the card answers "what have I been
 * working on", and a brand-new entry is the truest possible answer to it. It does
 * mean that on a quiet journal this list resembles the recent-entries grid — the two
 * diverge exactly as soon as somebody edits something old.
 *
 * **Log entries are kept**, matching `listPinnedEntries` rather than
 * `listTodayInHistory`: editing is an explicit act too, so an edited log entry is a
 * real answer to the question this card asks.
 */
export function listRecentlyEditedEntries(
  repo: JournalRepository,
  limit: number = RECENTLY_EDITED_ENTRY_LIMIT,
): JournalEntry[] {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`listRecentlyEditedEntries: limit must be a positive integer, got ${limit}.`);
  }

  return repo.findEntries(
    {
      join: "AND",
      // No conditions: every entry is a candidate, the sort is the whole point.
      groups: [],
      sort: [{ field: "updatedAt", direction: "desc" }],
    },
    limit,
  );
}
