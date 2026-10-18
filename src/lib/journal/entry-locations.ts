// "Which entries happened at this saved place?" — the use-cases behind
// Journal → Locations.
//
// The journal is allowed to know about the application-wide saved-location
// library: its entry form already picks from it. The library is **not** allowed
// to know about the journal — `lib/sys-locations` deliberately names no
// module's tables — so the counting lives here, on the journal's side of that
// line, rather than as a subquery in the library's repository.
//
// That is also why `SavedLocationWithUsage.usageCount` is still always 0 and is
// not what these functions return: filling it in would mean the library reading
// `jrn_entry_locations`, which is the dependency direction this arrangement
// exists to avoid.

import type { JournalEntry } from "./types";
import type { JournalRepository } from "./ports";

/** One saved place with the number of entries linking to it. */
export interface SavedLocationUsage {
  /** `sys_locations.id`. */
  savedLocationId: number;
  /** How many entries have at least one pin pointing here. Never negative. */
  entryCount: number;
}

/**
 * Attaches an entry count to each saved place id.
 *
 * Takes ids rather than whole places so this never has to name a
 * `sys_locations` shape: the caller holds the library rows, this answers only
 * the counting question, and the view puts the two together.
 *
 * Ids absent from the repository's map count 0 — a saved place nobody has
 * written about yet is an ordinary state, not a gap, and it stays in the list.
 */
export function countEntriesPerSavedLocation(
  repo: JournalRepository,
  savedLocationIds: readonly number[],
): SavedLocationUsage[] {
  const counts = repo.countEntriesBySavedLocation();
  return savedLocationIds.map((savedLocationId) => ({
    savedLocationId,
    entryCount: counts.get(savedLocationId) ?? 0,
  }));
}

/**
 * Every entry with a pin at this saved place, newest journal date first.
 *
 * Throws on a non-positive id rather than returning []: ids come from a route
 * segment, and "0 entries" would be indistinguishable from a place nobody has
 * written about, hiding a malformed URL instead of reporting it.
 */
export function listEntriesAtSavedLocation(
  repo: JournalRepository,
  savedLocationId: number,
): JournalEntry[] {
  if (!Number.isInteger(savedLocationId) || savedLocationId <= 0) {
    throw new Error(`Invalid saved location id: ${savedLocationId}`);
  }
  return repo.listEntriesBySavedLocation(savedLocationId);
}

/**
 * Whether anything is linked yet.
 *
 * For the section's "counts start from when linking was turned on" note, which
 * reads very differently before and after the first link: at zero it explains
 * why every row says 0, and after that it would just be noise.
 *
 * Deliberately a boolean and not a total. Summing the per-place counts would
 * double-count an entry pinned at two different saved places, so the honest
 * total is not available from this map — and "has anything linked yet" is the
 * only question the note actually asks.
 */
export function hasLinkedEntries(repo: JournalRepository): boolean {
  return repo.countEntriesBySavedLocation().size > 0;
}
