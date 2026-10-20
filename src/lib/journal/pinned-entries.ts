import type { JournalRepository } from "./ports";
import type { JournalEntry } from "./types";

/**
 * How many pinned entries the home card draws before it stops.
 *
 * A dashboard card, not the Entries list: the point is a glanceable shortlist, and
 * the card links to the full filtered list for the rest. Exported so the view can
 * say "showing the first N" without re-deciding the number.
 */
export const PINNED_ENTRY_LIMIT = 10;

/**
 * Every pinned entry, newest journal date first, up to `limit`.
 *
 * Built on `findEntries` rather than a new repository method, because the filter
 * engine already speaks `isPinned` — it is the field behind the `pinned = yes`
 * filter query, and the column has carried an index since migration 0027. A
 * dedicated `listPinnedEntries` port method would be a second way to ask the same
 * question, and the two would drift.
 *
 * **Log entries are deliberately kept.** `listTodayInHistory` strips them because an
 * imported calendar can bury the written entries that card exists to resurface — but
 * pinning is an explicit act. Somebody who pinned a logged activity meant to, and
 * silently dropping it here would make the card disagree with the pin button that put
 * it there.
 */
export function listPinnedEntries(
  repo: JournalRepository,
  limit: number = PINNED_ENTRY_LIMIT,
): JournalEntry[] {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`listPinnedEntries: limit must be a positive integer, got ${limit}.`);
  }

  return repo.findEntries(
    {
      join: "AND",
      groups: [
        { join: "AND", conditions: [{ field: "isPinned", operator: "is", value: "true" }] },
      ],
    },
    limit,
  );
}
