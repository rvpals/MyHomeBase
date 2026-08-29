import type { IconImageProcessor } from "./ports";
import type { RawBitmap } from "./types";

/**
 * The only file in the app that touches `sharp`.
 *
 * Kept to decode and encode alone, with every *decision* in `normalize-image.ts` — that
 * split is what lets the interesting logic be tested with a hand-built pixel array instead
 * of a real image and a native module.
 *
 * ## Why the import is lazy
 *
 * `sharp` is loaded on first use, not at module scope. It is reached through
 * `src/lib/wiring.ts`, which is the composition root that *every* page imports, so a
 * top-level `import sharp from "sharp"` runs on every render — turning a dependency that
 * only an icon upload needs into one the whole app needs to boot.
 *
 * That is not hypothetical. A NAS deploy that shipped the binding without its libvips
 * companion filled `app.log` with `ERR_DLOPEN_FAILED` on ordinary page views, because the
 * import fired during render rather than during an upload. With the import deferred, the
 * same broken install costs exactly one failed upload and an error message, and every other
 * screen is unaffected.
 *
 * ## Deploy note
 *
 * `sharp` is native, so the NAS needs the linux-arm64 build rather than the win32-x64 one
 * that installs on the dev machine — and it needs **two** packages: the binding and the
 * `libvips` library it dlopens. `scripts/publish-nas.mjs` fetches and verifies both.
 */
export class SharpIconImageProcessor implements IconImageProcessor {
  private sharpModule?: typeof import("sharp");

  /**
   * Loads `sharp` on demand, translating a native-module failure into something an admin
   * can act on. The driver's own message is a wall of install advice aimed at a developer.
   */
  private async lib(): Promise<typeof import("sharp")> {
    if (!this.sharpModule) {
      try {
        this.sharpModule = (await import("sharp")).default as unknown as typeof import("sharp");
      } catch (error) {
        throw new Error(
          "Image processing is unavailable on this server — the sharp module failed to load. " +
            "Upload an SVG instead, or reinstall/redeploy so sharp matches this platform. " +
            `(${error instanceof Error ? error.message.split("\n")[0] : String(error)})`,
        );
      }
    }
    return this.sharpModule;
  }

  async decode(data: Buffer): Promise<RawBitmap> {
    const sharp = await this.lib();

    // `ensureAlpha` so the output is always 4 channels: a JPEG decodes to 3, and the
    // caller's arithmetic indexes by 4 unconditionally.
    const { data: raw, info } = await sharp(data, { failOn: "error" })
      // An animated GIF flattens to its first frame. Accepted rather than rejected because
      // a still frame is a usable icon and refusing the upload helps nobody.
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    return { data: raw, width: info.width, height: info.height };
  }

  async encodePng(
    bitmap: RawBitmap,
    crop: { left: number; top: number; width: number; height: number },
    size: number,
  ): Promise<Buffer> {
    const sharp = await this.lib();

    return sharp(bitmap.data, {
      raw: { width: bitmap.width, height: bitmap.height, channels: 4 },
    })
      .extract(crop)
      // `fit: "contain"` with a transparent background rather than "cover": an icon must
      // never be cropped further to fill a square, and letterboxing with alpha is
      // invisible. `findContentBox` already squared the box, so this is normally a no-op.
      .resize(size, size, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        withoutEnlargement: false,
      })
      // compressionLevel 9 costs milliseconds once per upload and saves bytes in every
      // backup thereafter. `palette` lets libvips quantise flat icon art to an indexed
      // PNG, which is typically a further 2-3x smaller with no visible loss.
      .png({ compressionLevel: 9, palette: true })
      .toBuffer();
  }
}
