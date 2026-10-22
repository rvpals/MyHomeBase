import { CULLING_CONFIG, type CullingConfig } from "./config";
import type { AnalyzedPhoto, PhotoMetrics, ScoredPhoto } from "./types";

// Turning measurements into a ranking.
//
// Every metric is converted to a PERCENTILE RANK WITHIN THE BATCH before it is
// weighted, which is the central decision in this file. Absolute thresholds do not
// survive contact with a real archive: a Laplacian variance of 300 is tack-sharp from
// a phone at night and soft from a DSLR in daylight, and a "good" mean luminance
// differs between a snow scene and a candlelit room. Ranking asks the only question
// that can be answered without knowing the camera or the scene -- which of THESE
// pictures is sharper than the others.
//
// The consequence, which is intended: a batch of uniformly terrible photographs still
// produces a top-ranked one. Culling orders a set; it does not certify quality.

/**
 * Scores a batch against itself.
 *
 * @param photos The analysed images. Fewer than two is handled -- see below.
 * @param config Tunable weights and exposure thresholds.
 * @returns The same images with a 0-1 score and a reason string, best first.
 */
export function scoreBatch(
  photos: readonly AnalyzedPhoto[],
  config: CullingConfig = CULLING_CONFIG,
): ScoredPhoto[] {
  // A single image has nothing to be ranked against; every percentile would be 0.5 and
  // the score would say nothing. It is still returned with its reason, because "the
  // only photo in the folder" is a legitimate keeper.
  const sharpnessRanks = percentileRanks(photos.map((photo) => photo.metrics.sharpness));
  const centerRanks = percentileRanks(photos.map((photo) => photo.metrics.centerSharpness));
  const contrastRanks = percentileRanks(photos.map((photo) => photo.metrics.contrast));
  // Exposure is ranked on DISTANCE FROM MID-GREY rather than on brightness itself,
  // then inverted: the best exposure is the one nearest the middle, whereas the best
  // sharpness is simply the largest. Ranking brightness directly would declare the
  // brightest photo in the batch the best-exposed one, which is how a blown-out frame
  // wins.
  const exposureRanks = percentileRanks(
    photos.map((photo) => -Math.abs(photo.metrics.brightness - 128)),
  );

  const { weights } = config;
  const totalWeight =
    weights.sharpness + weights.centerSharpness + weights.contrast + weights.exposure;

  const scored = photos.map((photo, index) => {
    const weighted =
      sharpnessRanks[index] * weights.sharpness +
      centerRanks[index] * weights.centerSharpness +
      contrastRanks[index] * weights.contrast +
      exposureRanks[index] * weights.exposure;

    const penalty = exposurePenalty(photo.metrics, config);
    // Clamped at 0 rather than allowed negative: a score is a position on a 0-1 scale,
    // and a sort does not care whether a badly clipped frame is at 0 or at -0.1.
    const score = Math.max(0, weighted / totalWeight - penalty);

    return {
      ...photo,
      score,
      reason: describeScore(
        {
          sharpness: centerRanks[index],
          contrast: contrastRanks[index],
          exposure: exposureRanks[index],
        },
        photo.metrics,
        config,
      ),
    };
  });

  return sortByScore(scored);
}

/**
 * Sorts best first, breaking ties on path so the order is stable.
 *
 * Worth the tiebreak: two frames of a bracketed exposure can score identically, and a
 * run that returns them in a different order each time makes a diff of two JSON
 * outputs unreadable.
 */
export function sortByScore<T extends { score: number; relativePath: string }>(
  photos: readonly T[],
): T[] {
  return [...photos].sort(
    (left, right) =>
      right.score - left.score || left.relativePath.localeCompare(right.relativePath),
  );
}

/**
 * Each value's percentile rank within the array, 0-1.
 *
 * Ties share the average of the positions they span, so three identical values at the
 * bottom of five all rank 0.25 rather than 0, 0.25 and 0.5. Without that, a folder of
 * identical frames would get an arbitrary ordering that looked meaningful.
 *
 * A single value ranks 0.5 -- the middle -- because with nothing to compare against,
 * neutral is the only honest answer.
 *
 * @param values The raw measurements.
 * @returns Ranks in the same order as the input.
 */
export function percentileRanks(values: readonly number[]): number[] {
  if (values.length === 0) return [];
  if (values.length === 1) return [0.5];

  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);

  const ranks = new Array<number>(values.length);
  let position = 0;

  while (position < sorted.length) {
    // Span of equal values starting here.
    let end = position;
    while (end + 1 < sorted.length && sorted[end + 1].value === sorted[position].value) end += 1;

    const sharedRank = (position + end) / 2 / (values.length - 1);
    for (let index = position; index <= end; index += 1) ranks[sorted[index].index] = sharedRank;

    position = end + 1;
  }

  return ranks;
}

/**
 * How much to subtract for clipping, 0 to `maxPenalty`.
 *
 * Applied on top of the ranked exposure score rather than instead of it, because the
 * two catch different faults. The rank catches a frame that is merely darker than its
 * neighbours; the penalty catches one that has lost detail permanently -- a blown sky
 * is not recoverable no matter how it ranks against the rest of the folder.
 *
 * Shadow and highlight clipping are added rather than maxed: a harshly backlit frame
 * clips at both ends and deserves both penalties.
 *
 * @returns A number between 0 and `config.exposure.maxPenalty`.
 */
export function exposurePenalty(
  metrics: PhotoMetrics,
  config: CullingConfig = CULLING_CONFIG,
): number {
  const { clipTolerance, maxPenalty } = config.exposure;

  const excess = (clipped: number): number =>
    clipped <= clipTolerance ? 0 : (clipped - clipTolerance) / (1 - clipTolerance);

  const total = excess(metrics.shadowClipping) + excess(metrics.highlightClipping);
  return Math.min(maxPenalty, total * maxPenalty);
}

/**
 * The human-readable summary -- "sharp, well exposed, low contrast".
 *
 * Built from the ranks, not the raw numbers, so the words mean the same thing they do
 * in the score. Clipping is called out by name when it is bad enough to be penalised,
 * because "overexposed" tells a reader something "dark" does not.
 *
 * @returns A comma-separated phrase, never empty.
 */
export function describeScore(
  ranks: { sharpness: number; contrast: number; exposure: number },
  metrics: PhotoMetrics,
  config: CullingConfig = CULLING_CONFIG,
): string {
  const parts: string[] = [band(ranks.sharpness, "sharp", "soft", "slightly soft")];

  const { clipTolerance } = config.exposure;
  if (metrics.highlightClipping > clipTolerance) parts.push("overexposed");
  else if (metrics.shadowClipping > clipTolerance) parts.push("underexposed");
  else parts.push(band(ranks.exposure, "well exposed", "poorly exposed", "fairly exposed"));

  parts.push(band(ranks.contrast, "good contrast", "low contrast", "moderate contrast"));

  return parts.join(", ");
}

/** The word for a rank: top third, bottom third, or the middle. */
function band(rank: number, high: string, low: string, middle: string): string {
  if (rank >= 0.667) return high;
  if (rank <= 0.333) return low;
  return middle;
}
