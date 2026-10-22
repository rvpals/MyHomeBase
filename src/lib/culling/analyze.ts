import { CULLING_CONFIG } from "./config";
import { DHASH_HEIGHT, DHASH_WIDTH, differenceHash } from "./dhash";
import { measure } from "./metrics";
import type { AnalyzedPhoto, GrayscaleImage } from "./types";

/**
 * The only file in this module that touches `sharp`.
 *
 * Kept to decode alone, with every *decision* in `metrics.ts`, `score.ts` and
 * `dhash.ts` -- the same split as `lib/icons/image-processor.ts`, and for the same
 * reason: it lets the interesting logic be tested with a hand-built pixel array
 * instead of a real image and a native module.
 *
 * ## Why the import is lazy
 *
 * `sharp` is loaded on first use, not at module scope -- the rule this codebase
 * already follows in `lib/icons/image-processor.ts` and
 * `lib/modules/carousel-image-processor.ts`. Those files document the cost of getting
 * it wrong: the module graph reaches `src/lib/wiring.ts`, which every page imports, so
 * a top-level `import sharp from "sharp"` runs the native binding on every render. A
 * NAS deploy that shipped the binding without its libvips companion filled `app.log`
 * with `ERR_DLOPEN_FAILED` on ordinary page views. Deferred, the same broken install
 * costs exactly one failed culling run and a clear message.
 */

/** The default export's type, not the module namespace -- the latter has no call signature. */
type SharpConstructor = (typeof import("sharp"))["default"];

let sharpModule: SharpConstructor | undefined;

/**
 * Loads `sharp` on demand, translating a native-module failure into something
 * actionable.
 *
 * @returns The sharp constructor.
 * @throws If the native module cannot be loaded, with the install hint attached.
 */
async function lib(): Promise<SharpConstructor> {
  if (!sharpModule) {
    try {
      sharpModule = (await import("sharp")).default;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Image culling needs the "sharp" native module, which failed to load. ` +
          `On the NAS this usually means the linux-arm64 binding or its libvips ` +
          `companion is missing. Original error: ${detail}`,
      );
    }
  }
  return sharpModule;
}

/**
 * Measures one image and computes its duplicate hash.
 *
 * Both reductions come from ONE decode of the input buffer. Decoding twice would
 * double the expensive half of the work -- over SMB, the file read and decode dwarf
 * every calculation in this module.
 *
 * EXIF rotation is applied before anything is measured, so a portrait frame stored
 * sideways is cropped down its real centre rather than across it.
 *
 * @param bytes The image file's full contents.
 * @param relativePath Path relative to the archive root, carried into the result.
 * @param name The file's own name, for display.
 * @returns The measurements, the hash and the original dimensions.
 * @throws If the buffer is not a decodable image.
 */
export async function analyzeImage(
  bytes: Uint8Array,
  relativePath: string,
  name: string,
): Promise<AnalyzedPhoto> {
  const sharp = await lib();

  // `failOn: "none"` so a truncated-but-readable JPEG is measured rather than
  // rejected. Partially corrupt files are common in an archive this old, and half a
  // photograph still ranks honestly against the rest.
  const rotated = sharp(Buffer.from(bytes), { failOn: "none" }).rotate();

  const metadata = await rotated.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width === 0 || height === 0) throw new Error("Image has no readable dimensions.");

  const analysis = await toGrayscale(
    rotated.clone().resize({
      width: CULLING_CONFIG.analysisMaxEdge,
      height: CULLING_CONFIG.analysisMaxEdge,
      fit: "inside",
      // Small images are measured at their own size rather than upscaled: enlarging
      // invents smooth pixels, which would read as blur and under-rank a sharp
      // thumbnail.
      withoutEnlargement: true,
    }),
  );

  // The hash comes off the SAME rotated source, reduced hard to 9x8. `fit: "fill"`
  // ignores aspect ratio on purpose -- dHash compares one fixed grid against another,
  // so two crops of the same scene must land on the same grid to be comparable.
  const hashImage = await toGrayscale(
    rotated.clone().resize({ width: DHASH_WIDTH, height: DHASH_HEIGHT, fit: "fill" }),
  );

  return {
    relativePath,
    name,
    metrics: measure(analysis),
    hash: differenceHash(hashImage),
    width,
    height,
  };
}

/** Pulls raw single-channel bytes out of a sharp pipeline. */
async function toGrayscale(pipeline: import("sharp").Sharp): Promise<GrayscaleImage> {
  const { data, info } = await pipeline
    .greyscale()
    // One channel out, whatever came in -- an RGBA PNG and a CMYK TIFF both reduce to
    // the single plane the metrics expect.
    .toColourspace("b-w")
    .raw({ depth: "uchar" })
    .toBuffer({ resolveWithObject: true });

  return {
    width: info.width,
    height: info.height,
    pixels: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
  };
}
