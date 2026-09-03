import type { CarouselImageProcessor } from "./ports";

/**
 * The `sharp` adapter for carousel graphics. Decode and encode only — every
 * decision is in `resize-carousel-image.ts`.
 *
 * ## Why the import is lazy
 *
 * The same reason as `lib/icons/image-processor.ts`, and it is not hypothetical
 * there: this class is reached through `src/lib/wiring.ts`, which *every* page
 * imports, so a top-level `import sharp from "sharp"` would run on every render.
 * A NAS deploy that shipped the binding without its libvips companion once
 * filled `app.log` with `ERR_DLOPEN_FAILED` on ordinary page views. Deferred,
 * the same broken install costs one failed upload and a readable message.
 *
 * ## Deploy note
 *
 * `sharp` is native: the NAS needs the linux-arm64 build, not the win32-x64 one
 * that installs on the dev machine, and it needs **two** packages — the binding
 * and the `libvips` it dlopens. `scripts/publish-nas.mjs` already fetches and
 * verifies both for the icon processor, so this adds no new deploy step.
 */
export class SharpCarouselImageProcessor implements CarouselImageProcessor {
  private sharpModule?: typeof import("sharp");

  /**
   * Loads `sharp` on demand, translating a native-module failure into something
   * an admin can act on — the driver's own message is a wall of install advice
   * aimed at a developer.
   */
  private async lib(): Promise<typeof import("sharp")> {
    if (!this.sharpModule) {
      try {
        this.sharpModule = (await import("sharp")).default as unknown as typeof import("sharp");
      } catch (error) {
        throw new Error(
          "Image processing is unavailable on this server — the sharp module failed to load. " +
            "The graphic was not saved; reinstall or redeploy so sharp matches this platform. " +
            `(${error instanceof Error ? error.message.split("\n")[0] : String(error)})`,
        );
      }
    }
    return this.sharpModule;
  }

  async probe(data: Buffer): Promise<{ width: number; height: number }> {
    const sharp = await this.lib();
    const { width, height } = await sharp(data, { failOn: "error" }).metadata();

    // A format sharp reads but can't size is not one we should be storing and
    // then serving back from our own origin.
    if (!width || !height) throw new Error("That image's dimensions could not be read.");
    return { width, height };
  }

  async encodeWebp(data: Buffer, maxEdge: number, quality: number): Promise<Buffer> {
    const sharp = await this.lib();

    return (
      sharp(data, { failOn: "error" })
        // `fit: "inside"` + `withoutEnlargement`: fit the box, never crop, never
        // upscale. Cropping would silently trim somebody's artwork, and
        // upscaling a small graphic would add bytes to make it blurrier.
        .resize(maxEdge, maxEdge, { fit: "inside", withoutEnlargement: true })
        // Flattened to the first frame is the accepted cost for a still image;
        // `resizeCarouselImage` never sends an animated format down this path.
        .webp({ quality })
        .toBuffer()
    );
  }
}
