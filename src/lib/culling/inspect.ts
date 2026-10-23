import { isSafeRelativePath, normaliseRelativePath } from "../journal-photos";
import { analyzeImage } from "./analyze";
import { CULLING_CONFIG, type CullingConfig } from "./config";
import type { CullingImageStore } from "./ports";
import type { PhotoMetrics } from "./types";

// The use-case: what can be said about ONE photograph, on its own.
//
// ## Why this is not `cullPhotoPaths` with a single path
//
// It would run, and it would answer nothing. Culling is comparative by construction --
// `score.ts` converts every metric to a percentile rank WITHIN THE BATCH before
// weighting it, and `percentileRanks` returns `[0.5]` for a single value because with
// nothing to compare against, neutral is the only honest answer. So a one-photo cull
// scores ~0.5 and reads "slightly soft, fairly exposed, moderate contrast" for a
// tack-sharp frame and a ruined one alike. That is not a bug in the scorer; it is the
// scorer's documented contract -- "culling orders a set; it does not certify quality".
//
// What IS meaningful for one photograph is the layer underneath: `measure()` produces
// absolute, self-contained measurements, and they are simply discarded once the ranking
// is built. This file returns them instead, and deliberately returns NO score and NO
// keeper verdict -- there is no set, so there is nothing to be a keeper of.
//
// READ-ONLY, like everything else in this module: one `readImage` through the existing
// port, no new capability, nothing written.

/**
 * Which absolute judgements the measurements actually support.
 *
 * ONLY clipping. `config.exposure.clipTolerance` is a real absolute threshold -- a
 * fraction of pixels pinned at pure black or pure white is lost detail regardless of
 * what else was in the folder -- so "overexposed" is derivable from this photograph
 * alone.
 *
 * Sharpness and contrast get NO verdict here, and that omission is the point. A
 * Laplacian variance of 300 is tack-sharp from a phone at night and soft from a DSLR in
 * daylight; there is no absolute cutoff anywhere in this module because none exists.
 * Inventing one so the panel could say "sharp" would be exactly the dishonesty the
 * ranking was built to avoid. The numbers are reported; the reader judges them.
 */
export type ExposureVerdict = "overexposed" | "underexposed" | "no-clipping";

/** One photograph's own measurements, with no reference to any other photograph. */
export interface InspectedPhoto {
  readonly kind: "measured";
  /** Path relative to the archive root. */
  readonly relativePath: string;
  /** The file's own name, for display. */
  readonly name: string;
  /** The absolute measurements, in each metric's own units. */
  readonly metrics: PhotoMetrics;
  /** Pixel dimensions of the original, after EXIF rotation. */
  readonly width: number;
  readonly height: number;
  /** The one verdict the numbers support on their own. */
  readonly exposure: ExposureVerdict;
  /**
   * The clipping threshold the verdict was reached against, 0-1.
   *
   * Carried out rather than left in config so a reader can see what "overexposed"
   * meant, and so a changed tolerance cannot silently redefine a panel that quotes it.
   */
  readonly clipTolerance: number;
}

/** A photograph that could not be read or decoded, and why. */
export interface UninspectablePhoto {
  readonly kind: "unreadable";
  readonly relativePath: string;
  readonly name: string;
  readonly error: string;
}

/** What `inspectPhoto` returns: measurements, or the reason there are none. */
export type InspectResult = InspectedPhoto | UninspectablePhoto;

/**
 * Measures one photograph on its own terms.
 *
 * The path is ADDRESSED RELATIVE TO THE ARCHIVE ROOT and validated with the same guard
 * every other photo path crosses, which is what keeps a path arriving from a browser
 * from reaching outside the configured root.
 *
 * Nothing is written, moved or deleted -- the entire output is the returned result.
 *
 * A file that cannot be read or decoded comes back as `{ kind: "unreadable" }` rather
 * than throwing: the caller is a card that has to say something either way, and one
 * corrupt JPEG is an ordinary fact about an archive, not an exceptional condition.
 * A path that fails the safety guard DOES throw, because that is a programming error
 * or an attack, never a fact about a file.
 *
 * @param store Read-only access to the archive.
 * @param relativePath The photograph, relative to the archive root.
 * @param config Exposure thresholds; defaults to the module's.
 * @returns The measurements, or the reason they could not be taken.
 * @throws If `relativePath` is unsafe, or the archive root is unusable.
 */
export async function inspectPhoto(
  store: CullingImageStore,
  relativePath: string,
  config: CullingConfig = CULLING_CONFIG,
): Promise<InspectResult> {
  if (!isSafeRelativePath(relativePath)) {
    throw new Error(`Not a safe archive-relative path: ${relativePath}`);
  }

  const path = normaliseRelativePath(relativePath);
  const name = baseNameOf(path);

  // The specific reason, not just "unavailable" -- an unset path, a wrong one, and a
  // share the app cannot read need three different fixes. Thrown rather than returned:
  // a broken root is a configuration fault affecting every photo, not a fact about
  // this one, and reporting it as "this file is unreadable" would send the reader
  // hunting for a corrupt JPEG that does not exist.
  const rootCheck = await store.checkRoot();
  if (rootCheck.kind !== "ok") {
    throw new Error(
      `Photo archive is not usable (${rootCheck.kind})` +
        ("path" in rootCheck ? `: ${rootCheck.path}` : "."),
    );
  }

  let bytes: Uint8Array | undefined;
  try {
    bytes = await store.readImage(path);
  } catch (error) {
    return {
      kind: "unreadable",
      relativePath: path,
      name,
      error: error instanceof Error ? error.message : "File could not be read.",
    };
  }

  if (bytes === undefined) {
    return { kind: "unreadable", relativePath: path, name, error: "File could not be read." };
  }

  try {
    // The same decode the culler uses, so a photograph measured here and the same
    // photograph measured in a folder cull report identical numbers. Two decode paths
    // would be two sets of numbers that drift.
    const analyzed = await analyzeImage(bytes, path, name);

    return {
      kind: "measured",
      relativePath: analyzed.relativePath,
      name: analyzed.name,
      metrics: analyzed.metrics,
      width: analyzed.width,
      height: analyzed.height,
      exposure: exposureVerdict(analyzed.metrics, config),
      clipTolerance: config.exposure.clipTolerance,
    };
  } catch (error) {
    return {
      kind: "unreadable",
      relativePath: path,
      name,
      error: error instanceof Error ? error.message : "Image could not be decoded.",
    };
  }
}

/**
 * Highlights before shadows, matching `describeScore`.
 *
 * A harshly backlit frame clips at both ends, and the two orderings would disagree
 * about which word to use. Agreeing with the culler's wording matters more than the
 * choice itself -- the same picture must not be "overexposed" in one panel and
 * "underexposed" in another.
 */
export function exposureVerdict(
  metrics: PhotoMetrics,
  config: CullingConfig = CULLING_CONFIG,
): ExposureVerdict {
  const { clipTolerance } = config.exposure;
  if (metrics.highlightClipping > clipTolerance) return "overexposed";
  if (metrics.shadowClipping > clipTolerance) return "underexposed";
  return "no-clipping";
}

/** The file name at the end of an archive-relative path. */
function baseNameOf(relativePath: string): string {
  return relativePath.split("/").pop() ?? relativePath;
}
