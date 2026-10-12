// Whether a point is already in a list of points — the check the entry forms'
// location picker runs before appending.
//
// Lives here rather than in the picker because it is a decision about data, not
// about presentation: the same rule has to hold for the web form, the CLI, and
// anything else that assembles an entry's locations.

import { DEFAULT_DISTANCE_METRES, arePlacesNear } from "./dedup";

/**
 * The shape this module needs from a picked point.
 *
 * Deliberately structural rather than importing `JournalLocationInput` from
 * `src/app`: nothing under `src/lib` may depend on the presentation layer, and
 * the only fields that decide identity are the two below. The app's richer type
 * (with `locationName` and `savedLocationId`) satisfies this as-is.
 */
export interface LocationPoint {
  latitude: number;
  longitude: number;
}

/**
 * True when `candidate` occupies the same place as something already in `list`.
 *
 * "Same place" is the rule `dedup.ts` uses everywhere else in this module:
 * within `DEFAULT_DISTANCE_METRES` of each other, measured. Reused rather than
 * re-derived so the picker and the Merging & Dedup dialog cannot disagree about
 * what a duplicate is — two points the dialog would offer to merge are two
 * points this refuses to add.
 *
 * This compared *rounded coordinate keys* until the dialog stopped doing so.
 * Key equality looked like a distance test but was a grid: two points either
 * side of a rounding boundary never matched however close they were, so the
 * picker would happily append a pin 2m from one already in the list.
 *
 * Coordinates alone decide it. A name is not consulted, because the case this
 * exists to stop is the same place arriving twice under two names (a pin
 * dropped on the map, then the saved library row for the same spot), and
 * `savedLocationId` is not consulted for exactly the same reason.
 *
 * The cost of the radius is that two genuinely distinct addresses in one
 * building read as one place. That is the trade the rest of this module already
 * makes, and the duplicate it prevents is far more common than the pair it
 * conflates.
 */
export function isDuplicateLocation(
  list: readonly LocationPoint[],
  candidate: LocationPoint,
): boolean {
  return list.some((point) => arePlacesNear(point, candidate, DEFAULT_DISTANCE_METRES));
}

/**
 * The index of the first point in `list` that duplicates `candidate`, or -1.
 *
 * `isDuplicateLocation` answers the yes/no the picker needs to refuse an add;
 * this exists for a caller that has to say *which* row it clashed with.
 */
export function findDuplicateLocationIndex(
  list: readonly LocationPoint[],
  candidate: LocationPoint,
): number {
  return list.findIndex((point) => arePlacesNear(point, candidate, DEFAULT_DISTANCE_METRES));
}
