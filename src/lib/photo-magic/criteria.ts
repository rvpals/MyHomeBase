import type { IndexedPhoto, PhotoMagicCriteria } from "./types";
import { hasResolutionFilter } from "./types";

// Does one indexed photograph satisfy one set of criteria?
//
// Pure, and the SINGLE definition of what the criteria mean. The SQLite repository
// builds an equivalent WHERE clause for speed, and `repository.test.ts` is not the
// thing that keeps the two honest -- this function is, because the generator runs its
// result through `matchesCriteria` in the tests and the fake index uses it directly.
// If a rule changes, it changes here first.

/**
 * Whether this photograph belongs in a list built from these criteria.
 *
 * THE ABSENT-BOUND RULE, which is the whole semantics of the form: an `undefined` bound
 * is "no restriction on this end", never "match nothing". Leaving the minimum size
 * blank must widen the search, not empty it. Every check below is therefore guarded by
 * its bound's presence, and there are no defaults filled in anywhere -- a `0` standing
 * in for "no minimum" is how that rule gets quietly broken.
 *
 * `maxPhotos` is NOT consulted. It caps the draw after matching is done, which is
 * `selectPhotos`' job -- a photograph is not made ineligible by how many others there
 * are.
 */
export function matchesCriteria(
  photo: IndexedPhoto,
  criteria: PhotoMagicCriteria,
): boolean {
  // --- Date range ------------------------------------------------------------------
  //
  // String comparison, not `Date` parsing. Both sides are `YYYY-MM-DD`, a format whose
  // lexicographic order IS its chronological order, so this is exact and has no
  // timezone to shift a late-evening photo onto the next day. Parsing to `Date` here
  // would reintroduce precisely the bug `exif.ts` warns about.
  if (criteria.fromDate !== undefined || criteria.toDate !== undefined) {
    // A photograph with no established date cannot satisfy a range. Excluded rather
    // than admitted, because a date criterion is a positive claim about when the
    // picture was taken and "we don't know" does not support it.
    if (photo.takenAtDate === undefined) return false;
    if (criteria.fromDate !== undefined && photo.takenAtDate < criteria.fromDate) return false;
    if (criteria.toDate !== undefined && photo.takenAtDate > criteria.toDate) return false;
  }

  // --- File size -------------------------------------------------------------------
  //
  // Inclusive at both ends: a reader asking for "at least 4 MB" means a 4 MB file is in.
  if (criteria.minBytes !== undefined && photo.bytes < criteria.minBytes) return false;
  if (criteria.maxBytes !== undefined && photo.bytes > criteria.maxBytes) return false;

  // --- Resolution ------------------------------------------------------------------
  //
  // Unknown dimensions are EXCLUDED by any resolution bound, rather than passed
  // through. The alternative -- admitting them -- would put photographs of unknown size
  // into a list whose entire purpose was "only the big ones", which is the failure a
  // reader would notice and could not explain. The count of these is reported in the
  // stats so the exclusion is visible rather than silent.
  if (hasResolutionFilter(criteria)) {
    if (photo.width === undefined || photo.height === undefined) return false;
    if (criteria.minWidth !== undefined && photo.width < criteria.minWidth) return false;
    if (criteria.minHeight !== undefined && photo.height < criteria.minHeight) return false;
    if (criteria.maxWidth !== undefined && photo.width > criteria.maxWidth) return false;
    if (criteria.maxHeight !== undefined && photo.height > criteria.maxHeight) return false;
  }

  return true;
}

/**
 * Whether a photograph sits in the criteria's date range, ignoring every other bound.
 *
 * What `countUnknownSizeInRange` needs: "how many pictures from the right period did
 * the resolution filter throw away". Asking that question with the size and resolution
 * bounds still applied would answer zero by construction.
 */
export function matchesDateRange(
  photo: IndexedPhoto,
  criteria: PhotoMagicCriteria,
): boolean {
  if (criteria.fromDate === undefined && criteria.toDate === undefined) return true;
  if (photo.takenAtDate === undefined) return false;
  if (criteria.fromDate !== undefined && photo.takenAtDate < criteria.fromDate) return false;
  if (criteria.toDate !== undefined && photo.takenAtDate > criteria.toDate) return false;
  return true;
}

/**
 * A one-line English rendering of what the criteria will look for.
 *
 * Domain logic rather than a view helper, so the web app's summary line and the CLI's
 * output say the same thing -- the same call `formatRunningTime` makes in the music
 * module. The view would otherwise grow its own copy and the two would drift.
 */
export function describeCriteria(criteria: PhotoMagicCriteria): string {
  const parts: string[] = [];

  if (criteria.fromDate !== undefined && criteria.toDate !== undefined) {
    parts.push(`taken between ${criteria.fromDate} and ${criteria.toDate}`);
  } else if (criteria.fromDate !== undefined) {
    parts.push(`taken on or after ${criteria.fromDate}`);
  } else if (criteria.toDate !== undefined) {
    parts.push(`taken on or before ${criteria.toDate}`);
  }

  if (criteria.minBytes !== undefined && criteria.maxBytes !== undefined) {
    parts.push(`between ${mb(criteria.minBytes)} and ${mb(criteria.maxBytes)}`);
  } else if (criteria.minBytes !== undefined) {
    parts.push(`at least ${mb(criteria.minBytes)}`);
  } else if (criteria.maxBytes !== undefined) {
    parts.push(`no more than ${mb(criteria.maxBytes)}`);
  }

  // Width and height are reported as a pair when both are set, because "1920 × 1080" is
  // how a reader thinks of a resolution -- two separate clauses for the same bound
  // would read as two unrelated conditions.
  if (criteria.minWidth !== undefined && criteria.minHeight !== undefined) {
    parts.push(`at least ${criteria.minWidth} × ${criteria.minHeight}`);
  } else if (criteria.minWidth !== undefined) {
    parts.push(`at least ${criteria.minWidth} px wide`);
  } else if (criteria.minHeight !== undefined) {
    parts.push(`at least ${criteria.minHeight} px tall`);
  }

  if (criteria.maxWidth !== undefined && criteria.maxHeight !== undefined) {
    parts.push(`no larger than ${criteria.maxWidth} × ${criteria.maxHeight}`);
  } else if (criteria.maxWidth !== undefined) {
    parts.push(`no wider than ${criteria.maxWidth} px`);
  } else if (criteria.maxHeight !== undefined) {
    parts.push(`no taller than ${criteria.maxHeight} px`);
  }

  const what = parts.length === 0 ? "Any photograph" : `Photographs ${parts.join(", ")}`;
  return `${what} — up to ${criteria.maxPhotos}.`;
}

/** Megabytes to one decimal, for the description line only. */
function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
