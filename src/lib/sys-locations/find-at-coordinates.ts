// Which saved places already sit where a new one is about to go — the read
// behind the Location Manager's "we already have this location" warning.
//
// Separate from `duplicate-in-list.ts` next door, which answers a yes/no about
// a list being assembled in a form. This one answers *which rows*, because the
// warning has to name them ("… as CVS Pharmacy (Beekman corner)").

import { DEFAULT_DISTANCE_METRES, arePlacesNear } from "./dedup";
import type { SavedLocation } from "./types";

/** The shape this module needs from a candidate. Structural, like LocationPoint. */
export interface CandidatePoint {
  latitude: number;
  longitude: number;
}

/**
 * Every saved place occupying the same spot as `candidate`, nearest first.
 *
 * "Same spot" is `DEFAULT_DISTANCE_METRES`, the rule the rest of this module
 * already uses — reused rather than re-derived so this warning and the Merging
 * & Dedup dialog cannot disagree about what a duplicate is. An exact-match test
 * would miss a pin nudged two metres, which is the common way the same place
 * gets saved twice.
 *
 * `excludeId` drops one row from the result: an edit re-saving a place must not
 * warn that it duplicates itself. Pass the id being edited; omit it on a create.
 *
 * Nearest first so the warning names the most likely match when there are
 * several, and the caller can take [0] without sorting.
 *
 * Returns rows, not a boolean: the warning quotes the existing name and
 * coordinates, and a yes/no would send the caller back for a second read.
 */
export function findLocationsAtCoordinates(
  locations: readonly SavedLocation[],
  candidate: CandidatePoint,
  excludeId?: number,
): SavedLocation[] {
  return locations
    .filter((place) => place.id !== excludeId)
    .filter((place) => arePlacesNear(place, candidate, DEFAULT_DISTANCE_METRES))
    .sort((a, b) => squaredOffset(a, candidate) - squaredOffset(b, candidate));
}

/**
 * Squared coordinate offset, for ordering only.
 *
 * Squared and un-rooted, and in degrees rather than metres: both are monotonic
 * in true distance over the handful of metres this ever compares, so the sort
 * order is right and the arithmetic stays exact. Never read as a distance.
 */
function squaredOffset(place: CandidatePoint, candidate: CandidatePoint): number {
  const dLat = place.latitude - candidate.latitude;
  const dLon = place.longitude - candidate.longitude;
  return dLat * dLat + dLon * dLon;
}
