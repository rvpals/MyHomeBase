import type { RawBitmap } from "./detect-marks";

/**
 * One of three files in this codebase that touch `sharp` — the others are
 * `lib/icons/image-processor.ts` and `lib/modules/carousel-image-processor.ts`, which
 * follow the same shape for the same reasons.
 *
 * Kept to **decoding alone**, with every decision in `detect-marks.ts`. That split is
 * what lets the interesting logic be tested with a hand-built pixel array instead of a
 * real photograph and a native module.
 *
 * ## Why the import is lazy
 *
 * `sharp` is loaded on first use, not at module scope. It is reached through
 * `src/lib/wiring.ts`, which every page imports, so a top-level `import sharp` runs on
 * every render — turning a dependency only grading needs into one the whole app needs
 * to boot.
 *
 * That is not hypothetical. A NAS deploy that shipped the binding without its libvips
 * companion filled `app.log` with `ERR_DLOPEN_FAILED` on ordinary page views, because
 * the import fired during render rather than during an upload. Deferred, the same
 * broken install costs exactly one failed grading run and an error message.
 *
 * ## Deploy note
 *
 * `sharp` is native, so the NAS needs the linux-arm64 build rather than the win32-x64
 * one that installs on the dev machine — and it needs **two** packages: the binding
 * and the `libvips` library it dlopens. `scripts/publish-nas.mjs` fetches and verifies
 * both.
 */
export interface SheetImageProcessor {
  /** Decodes a scan to straight RGBA. Throws if the bytes are not a readable image. */
  decode(data: Buffer): Promise<RawBitmap>;
}

/**
 * The longest edge a scan is resized to before sampling.
 *
 * A phone photograph can be 4000px wide, and grading reads a few hundred small
 * windows — most of that resolution is cost without benefit. 1700px keeps a bubble
 * around 44px across, far more than the sampler needs, while cutting the pixel count
 * of a 12MP photo by about 85%.
 *
 * Downscaling also *helps* accuracy: averaging neighbouring pixels suppresses the
 * paper grain and JPEG ringing that a full-resolution sample would read as ink.
 */
export const MAX_SCAN_EDGE = 1700;

export class SharpSheetImageProcessor implements SheetImageProcessor {
  // The **default export's** type, not `typeof import("sharp")`. The latter is the
  // module namespace, which has no call signature.
  private sharpModule?: (typeof import("sharp"))["default"];

  private async lib(): Promise<(typeof import("sharp"))["default"]> {
    if (!this.sharpModule) {
      try {
        this.sharpModule = (await import("sharp")).default;
      } catch (error) {
        throw new Error(
          "Grading is unavailable on this server — the sharp image module failed to load. " +
            "Reinstall or redeploy so sharp matches this platform. " +
            `(${error instanceof Error ? error.message.split("\n")[0] : String(error)})`,
        );
      }
    }
    return this.sharpModule;
  }

  async decode(data: Buffer): Promise<RawBitmap> {
    const sharp = await this.lib();

    const { data: raw, info } = await sharp(data, { failOn: "error" })
      // `rotate()` with no argument applies the EXIF orientation. A phone photograph
      // routinely carries one, and a sheet read sideways grades as nonsense — this is
      // the single most likely way a real scan fails.
      .rotate()
      .resize(MAX_SCAN_EDGE, MAX_SCAN_EDGE, { fit: "inside", withoutEnlargement: true })
      // `ensureAlpha` so the output is always 4 channels: a JPEG decodes to 3, and the
      // sampler indexes by 4 unconditionally.
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    return { data: raw, width: info.width, height: info.height };
  }
}
