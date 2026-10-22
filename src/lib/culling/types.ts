// The shapes the culler passes around. No behaviour here.

/** A decoded image reduced to what the metrics need: 8-bit grayscale and its size. */
export interface GrayscaleImage {
  readonly width: number;
  readonly height: number;
  /** One byte per pixel, row-major, `width * height` long. */
  readonly pixels: Uint8Array;
}

/**
 * What one image measures, before any comparison with the rest of the batch.
 *
 * Absolute values, in each metric's own units — a Laplacian variance of 420 means
 * nothing on its own. `score.ts` turns these into ranks within a batch, which is the
 * only form in which they are comparable.
 */
export interface PhotoMetrics {
  /** Variance of the Laplacian over the whole frame. Higher is sharper. */
  readonly sharpness: number;
  /** The same over the centre 50% of the frame, where the subject usually is. */
  readonly centerSharpness: number;
  /** Mean luminance, 0–255. */
  readonly brightness: number;
  /** Standard deviation of luminance, 0–127ish. */
  readonly contrast: number;
  /** Fraction of pixels at or below the shadow level, 0–1. */
  readonly shadowClipping: number;
  /** Fraction of pixels at or above the highlight level, 0–1. */
  readonly highlightClipping: number;
}

/** One image that was measured successfully, with its 64-bit dHash. */
export interface AnalyzedPhoto {
  /** Path relative to the archive root — the form every other photo module uses. */
  readonly relativePath: string;
  /** The file's own name, for display. */
  readonly name: string;
  readonly metrics: PhotoMetrics;
  /**
   * 64-bit difference hash as a 16-character hex string.
   *
   * Hex rather than a `bigint` so it survives JSON output and an equality check
   * without a custom serialiser.
   */
  readonly hash: string;
  /** Pixel dimensions of the original, before analysis downsampling. */
  readonly width: number;
  readonly height: number;
}

/** One image that could not be measured, and why. */
export interface AnalysisFailure {
  readonly relativePath: string;
  readonly name: string;
  readonly error: string;
}

/** Why an image did not make the keepers list. */
export type RejectReason = "duplicate" | "low score" | "unreadable" | "exposure";

/**
 * A scored image: its metrics, its rank-based score, and the sentence explaining it.
 *
 * `score` is 0–1. `reason` is the human-readable summary — "sharp, well exposed, low
 * contrast" — assembled from which bands the ranks fell into.
 */
export interface ScoredPhoto extends AnalyzedPhoto {
  readonly score: number;
  readonly reason: string;
}

/** A scored image that was set aside, with the reason and any duplicate it lost to. */
export interface RejectedPhoto extends ScoredPhoto {
  readonly rejectReason: RejectReason;
  /**
   * The keeper this image duplicates, when `rejectReason` is `"duplicate"`.
   *
   * Present so a reader can see *what* it was a duplicate of rather than being told
   * only that it lost.
   */
  readonly duplicateOf?: string;
}

/** An image that never got a score, because it could not be read. */
export interface UnreadablePhoto extends AnalysisFailure {
  readonly rejectReason: "unreadable";
}

/** What `cullFolder` returns. */
export interface CullResult {
  /** The folder that was culled, relative to the archive root. */
  readonly folder: string;
  /** The best image from each duplicate group, best first. */
  readonly keepers: readonly ScoredPhoto[];
  /** Everything else that was scored, best first. */
  readonly rejects: readonly RejectedPhoto[];
  /** Files that could not be decoded at all. */
  readonly unreadable: readonly UnreadablePhoto[];
  /** How many files were considered, including the unreadable ones. */
  readonly examined: number;
  /** How many duplicate groups held more than one image. */
  readonly duplicateGroups: number;
}

/** Options for one culling run. */
export interface CullOptions {
  /** Hamming distance for duplicate grouping. Defaults to the config value. */
  readonly duplicateDistance?: number;
  /** How many images to decode at once. Defaults to the config value. */
  readonly concurrency?: number;
  /**
   * Keep only the best `keepCount` images; the rest become `"low score"` rejects.
   *
   * Off by default, and deliberately so: a culler that discards on a threshold nobody
   * chose is hard to trust, and the caller is the one who knows how many pictures they
   * want. With neither this nor `keepFraction` set, every non-duplicate is a keeper.
   */
  readonly keepCount?: number;
  /** The same as a fraction of the images that scored, 0–1. Ignored if `keepCount` is set. */
  readonly keepFraction?: number;

  /**
   * Score only these file names, instead of everything in the folder.
   *
   * The photo dialog's case: it has already filtered a month folder down to the
   * pictures taken on one day, and culling the whole month would both cost minutes and
   * answer a question nobody asked. Names rather than paths, matching what
   * `listImageNames` returns.
   *
   * A name that is not in the folder is ignored rather than reported — the caller's
   * list and the folder are read at different moments, so a file deleted in between is
   * an ordinary race, not an error.
   */
  readonly only?: readonly string[];

  /**
   * The most images this call may decode, overriding the built-in default.
   *
   * The server actions resolve this from the stored setting and pass it in, so the
   * ceiling can be corrected without a deploy. A caller with no settings to read — the
   * CLI — omits it and gets `MAX_CULL_IMAGES`.
   */
  readonly maxImages?: number;
}

/**
 * What `cullPhotoPaths` returns: a verdict over an arbitrary set of photographs.
 *
 * Distinct from `CullResult` because there is no single folder to name, and because a
 * set can be larger than the ceiling and get truncated — two facts a folder cull never
 * has to report.
 */
export interface CullPathsResult {
  /** The best of each duplicate group, best first. */
  readonly keepers: readonly ScoredPhoto[];
  /** Everything else that was scored, best first. */
  readonly rejects: readonly RejectedPhoto[];
  /** Files that could not be decoded at all. */
  readonly unreadable: readonly UnreadablePhoto[];
  /** How many paths the caller asked about. */
  readonly requested: number;
  /** How many were actually scored, after any truncation. */
  readonly examined: number;
  /** True when `requested` exceeded the ceiling and the tail was not scored. */
  readonly wasTruncated: boolean;
  /** How many duplicate groups held more than one image. */
  readonly duplicateGroups: number;
}
