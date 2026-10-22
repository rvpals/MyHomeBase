// Every tunable number in one object, so tuning the culler never means hunting through
// the maths. Nothing in this module reads a magic number from anywhere else.
//
// The weights are deliberately *relative*, not percentages that must sum to 1 — the
// score normalises by their total. That way raising `sharpness` to 4 does not require
// recomputing the other three to keep the scale.

/** Image extensions this module will decode. See `UNSUPPORTED_EXTENSIONS` for heic. */
export const SUPPORTED_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "tiff", "tif"] as const;

/**
 * Extensions a caller is likely to expect and will not get.
 *
 * `sharp` 0.35's prebuilt binaries ship without libheif, so a `.heic` cannot be
 * decoded here at all. Listed rather than ignored because silently skipping an iPhone
 * folder — where every file is HEIC — would look exactly like a culler that found no
 * photos. These become an `unreadable` reject carrying the reason.
 */
export const UNSUPPORTED_EXTENSIONS = ["heic", "heif"] as const;

/**
 * The default ceiling on how many photographs one culling pass will decode.
 *
 * AN ESTIMATE, NOT A MEASUREMENT, and worth correcting once a real run has been timed
 * on the hardware that matters. It was extrapolated from the one real number in this
 * codebase: `journal-photos/photos.ts` records a cold 1,187-photo folder taking ~13s
 * to scan, which is ~11ms per photo for a 64KB HEADER read. Culling reads each file
 * WHOLE and decodes it -- roughly a hundred times the bytes, plus sharp's decode and
 * two resizes -- so a few hundred milliseconds per photo was assumed, putting 300 at
 * somewhere around a minute.
 *
 * Two things can make it worse than that guess: a set spanning many folders has no
 * read locality, and the NAS is ARM, where sharp decodes slower than on an x86 dev
 * machine. Hence the setting -- see `settings.ts`.
 */
export const DEFAULT_CULL_IMAGES = 300;

/** The smallest ceiling worth offering: below this, culling cannot rank meaningfully. */
export const MIN_CULL_IMAGES = 10;

/**
 * The largest ceiling an admin may set.
 *
 * A guard against a server action that runs until it is killed, rather than a claim
 * that 2,000 photographs will succeed. At the per-photo cost above this is many
 * minutes, and a long-running action risks a platform timeout; the number exists so a
 * hand-edited settings row cannot ask for an unbounded decode.
 */
export const MAX_CULL_CEILING = 2000;

export interface CullingConfig {
  /** Relative importance of each metric in the combined score. */
  readonly weights: {
    /** Sharpness over the whole frame. */
    readonly sharpness: number;
    /**
     * Sharpness over the centre 50%.
     *
     * Carried separately, and weighted highest of the two, because a portrait with a
     * deliberately blurred background scores poorly on the full frame while being
     * exactly the picture worth keeping.
     */
    readonly centerSharpness: number;
    /** Spread of luminance — flat, hazy frames rank low. */
    readonly contrast: number;
    /** How close mean luminance sits to the midpoint. */
    readonly exposure: number;
  };

  /**
   * Fraction of pixels at the extremes that counts as clipped.
   *
   * Some clipping is normal — a sky, a lamp, a black shadow — so the penalty starts
   * above these fractions rather than at the first clipped pixel.
   */
  readonly exposure: {
    /** Pixels at or below this value count as crushed shadow. */
    readonly shadowLevel: number;
    /** Pixels at or above this value count as blown highlight. */
    readonly highlightLevel: number;
    /** Clipped fraction above which the penalty begins. */
    readonly clipTolerance: number;
    /** Score subtracted at full clipping, scaled linearly from `clipTolerance`. */
    readonly maxPenalty: number;
  };

  /** Longest edge, in pixels, that analysis downsamples to before measuring. */
  readonly analysisMaxEdge: number;

  /** Hamming distance between two 64-bit dHashes at or below which they are duplicates. */
  readonly duplicateDistance: number;

  /**
   * How many images are decoded at once.
   *
   * Four because these files usually sit on an SMB share: enough requests in flight to
   * hide the round-trip latency, few enough that a thousand-photo folder does not
   * flood the NAS. The same reasoning, and nearly the same number, as the journal's
   * `SCAN_CONCURRENCY`.
   */
  readonly concurrency: number;
}

export const CULLING_CONFIG: CullingConfig = {
  weights: {
    sharpness: 2,
    centerSharpness: 3,
    contrast: 1.5,
    exposure: 1,
  },
  exposure: {
    shadowLevel: 5,
    highlightLevel: 250,
    clipTolerance: 0.02,
    maxPenalty: 0.25,
  },
  analysisMaxEdge: 1024,
  duplicateDistance: 10,
  concurrency: 4,
};
