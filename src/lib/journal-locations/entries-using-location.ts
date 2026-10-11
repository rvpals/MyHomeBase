// "Which entries is this place from?" — the read behind the Location Manager's
// usage count.
//
// Its own file rather than another function in `journal-locations.ts`: this is
// the one read in the module that is *about* journal entries rather than about
// places, and the comment explaining that boundary deserves somewhere to live.
// See `ports.ts` → `listEntriesUsingLocation` for why the query belongs on this
// side of the module line at all.

import type { SavedLocationRepository } from "./ports";
import { locationIdSchema } from "./schema";
import type { EntryUsingLocation } from "./types";

/**
 * The journal entries using a saved place, newest first, one row per entry.
 *
 * An unknown id returns `[]` rather than throwing: a place deleted in another
 * tab is an empty list, not an error, and the caller renders both the same way.
 * A malformed id (0, -1, 2.5) *does* throw — that is a bug in the caller, not a
 * place that happens to be unused.
 *
 * The returned list can be shorter than the place's `usageCount`, which counts
 * entry-location rows: an entry visiting the same place twice is one row here
 * with `locationCount: 2`. The popup says so in words rather than leaving two
 * numbers to disagree on screen.
 */
export function listEntriesUsingLocation(
  repo: SavedLocationRepository,
  id: number,
): EntryUsingLocation[] {
  return repo.listEntriesUsingLocation(locationIdSchema.parse(id));
}
