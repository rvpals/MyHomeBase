import type { PhotoThumbnailRenderer } from "./ports";

/**
 * The real `PhotoThumbnailRenderer`, over `sharp`.
 *
 * ## Why the import is lazy
 *
 * Same rule and same reason as `lib/icons/image-processor.ts`: this is reached through
 * `src/lib/wiring.ts`, which every page imports, and a NAS deploy whose linux-arm64
 * binding is missing its libvips companion would otherwise throw on ordinary page
 * views. Deferred, a broken install costs only thumbnails -- and `readPhotoThumbnail`
 * then serves the original, which is what the strip did before thumbnails existed.
 *
 * ## Why this is cheap on the server
 *
 * sharp decodes and resizes in native code on its own threads, not on Node's event
 * loop, and for a JPEG it shrinks WHILE decoding (libjpeg's DCT scaling), so a 12MP
 * original is never decoded at full size to make a 160px thumbnail.
 */
export class SharpPhotoThumbnailRenderer implements PhotoThumbnailRenderer {
  private sharpModule?: (typeof import("sharp"))["default"];

  private async lib(): Promise<(typeof import("sharp"))["default"]> {
    if (!this.sharpModule) {
      try {
        this.sharpModule = (await import("sharp")).default;
      } catch (error) {
        throw new Error(
          "Photo thumbnails are unavailable on this server -- the sharp module failed to load. " +
            `(${error instanceof Error ? error.message.split("\n")[0] : String(error)})`,
        );
      }
    }
    return this.sharpModule;
  }

  async render(
    bytes: Uint8Array,
    options: {
      size: number;
      transform?: { rotate: 0 | 90 | 180 | 270; flop: boolean; flip: boolean };
    },
  ): Promise<Uint8Array> {
    const sharp = await this.lib();
    // `failOn: "none"`: a slightly damaged camera file still deserves a thumbnail.
    let image = sharp(bytes, { failOn: "none" });

    if (options.transform === undefined) {
      // No argument: orient from the image's own EXIF tag. Right for an original.
      image = image.rotate();
    } else {
      // An EXIF preview carries no tag of its own, so apply the original's correction.
      // sharp performs the rotation before the mirroring, which is the order
      // `orientationTransform` describes.
      const { rotate, flop, flip } = options.transform;
      if (rotate !== 0) image = image.rotate(rotate);
      if (flop) image = image.flop();
      if (flip) image = image.flip();
    }

    const output = await image
      // `outside`: the SHORTER side is `size`, so the square slot's `object-cover` crop
      // never has to upscale.
      .resize(options.size, options.size, { fit: "outside", withoutEnlargement: true })
      .jpeg({ quality: 75, mozjpeg: false })
      .toBuffer();
    return new Uint8Array(output);
  }
}
