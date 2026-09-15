import { shuffle, type RandomSource } from "@/lib/shared/random";
import type {
  GeneratedPhotoSet,
  IndexedPhoto,
  PhotoMagicCriteria,
  PhotoMagicStats,
} from "./types";

// Drawing the list from the candidates.
//
// Pure and separate from `magic.ts` so the draw can be tested against a hand-written
// array with a deterministic random source -- no database, no filesystem. The music
// module splits `generate.ts` from `magic.ts` the same way and for the same reason.

/**
 * Draws up to `maxPhotos` photographs at random from the candidates.
 *
 * A RANDOM SAMPLE, not the first N. That is the feature: "a magical list" means a
 * different set of pictures each time you ask, so taking the head of the candidate list
 * would return the same photographs from the same folder on every run and make the
 * ceiling look like a bug. Shuffling the whole candidate set and slicing is the honest
 * way to do it -- every candidate has an equal chance of appearing.
 *
 * The shuffled ORDER is kept as the list's order, rather than re-sorting by date
 * afterwards. A slideshow of a decade's photographs in a surprising order is the point;
 * chronological is what browsing the archive already gives you.
 *
 * `random` is injected rather than called as `Math.random` so the tests are
 * deterministic -- the port-shaped parameter `shuffle` already expects.
 */
export function selectPhotos(
  candidates: readonly IndexedPhoto[],
  criteria: PhotoMagicCriteria,
  random: RandomSource,
  options: { excludedUnknownSize?: number } = {},
): GeneratedPhotoSet {
  // A ceiling of zero or less would be a list that cannot contain anything; the schema
  // refuses it at the boundary, and this is the belt-and-braces for a caller that
  // skipped validation. `Math.max` rather than throwing, matching how the range lookup
  // treats an inverted range as an ordinary empty result.
  const limit = Math.max(0, Math.floor(criteria.maxPhotos));

  const drawn = shuffle(candidates, random).slice(0, limit);

  const stats: PhotoMagicStats = {
    candidateCount: candidates.length,
    selectedCount: drawn.length,
    maxPhotos: limit,
    // True when the CEILING is what limited the result, rather than the criteria
    // running out of matches. The distinction is what tells a reader whether raising
    // the number would give them more pictures or whether they need to widen the dates.
    cappedByLimit: candidates.length > limit,
    excludedUnknownSize: options.excludedUnknownSize ?? 0,
  };

  return { photos: drawn, stats };
}

/**
 * A sentence explaining what a generation produced, and why it might be thin.
 *
 * Domain logic rather than view code, so the CLI and the web app say the same thing.
 * The honest explanation of a small result is the whole reason the stats exist: four
 * criteria ANDed together can match far less than expected, and without this the reader
 * sees eleven pictures where they asked for a hundred and concludes the feature is
 * broken. Mirrors `describeGeneration` in the music module.
 */
export function describeGeneration(stats: PhotoMagicStats): string {
  if (stats.candidateCount === 0) {
    const base = "No photographs in the index match those criteria.";
    // The one case where "nothing matched" has a specific, fixable cause worth naming.
    if (stats.excludedUnknownSize > 0) {
      return `${base} ${stats.excludedUnknownSize} photograph${
        stats.excludedUnknownSize === 1 ? "" : "s"
      } in that date range had no readable dimensions, so the resolution filter excluded ${
        stats.excludedUnknownSize === 1 ? "it" : "them"
      }.`;
    }
    return `${base} Try widening the dates, or scan a larger range first.`;
  }

  const drew = `Drew ${stats.selectedCount} of ${stats.candidateCount} matching photograph${
    stats.candidateCount === 1 ? "" : "s"
  }`;

  const parts: string[] = [];
  if (stats.cappedByLimit) {
    parts.push(`limited to ${stats.maxPhotos} — raise the ceiling for more`);
  }
  if (stats.excludedUnknownSize > 0) {
    parts.push(
      `${stats.excludedUnknownSize} in range excluded for unreadable dimensions`,
    );
  }

  return parts.length === 0 ? `${drew}.` : `${drew} (${parts.join("; ")}).`;
}
