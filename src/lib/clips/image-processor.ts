import type { DecodedImage } from "@/lib/shared/image-upload";
import type { ClipImageProcessor } from "./ports";

/**
 * The `sharp` adapter for pasted clip images. Decode, resize and encode only —
 * no decisions beyond "fit inside this box".
 *
 * ## Why the import is lazy
 *
 * The same reason as `lib/icons/image-processor.ts` and
 * `lib/modules/carousel-image-processor.ts`, and it is not hypothetical there:
 * this class is reached through `src/lib/wiring.ts`, which *every* page imports,
 * so a top-level `import sharp from "sharp"` would run on every render. A NAS
 * deploy that shipped the binding without its libvips companion once filled
 * `app.log` with `ERR_DLOPEN_FAILED` on ordinary page views. Deferred, the same
 * broken install costs one failed paste and a readable message.
 *
 * ## Deploy note
 *
 * `sharp` is native: the NAS needs the linux-arm64 build, not the win32-x64 one
 * that installs on the dev machine, and it needs **two** packages — the binding
 * and the `libvips` it dlopens. `scripts/publish-nas.mjs` already fetches and
 * verifies both for the icon processor, so this adds no new deploy step.
 */
export class SharpClipImageProcessor implements ClipImageProcessor {
  // The **default export's** type, not `typeof import("sharp")`. The latter is
  // the module namespace, which has no call signature — sharp 0.35 exports a
  // `SharpConstructor` as its default, so typing the cache as the namespace
  // makes every `sharp(...)` call below a type error.
  private sharpModule?: (typeof import("sharp"))["default"];

  private async lib(): Promise<(typeof import("sharp"))["default"]> {
    if (!this.sharpModule) {
      try {
        this.sharpModule = (await import("sharp")).default;
      } catch (error) {
        throw new Error(
          "Image processing is unavailable on this server — the sharp module failed to load. " +
            "The image was not saved; reinstall or redeploy so sharp matches this platform. " +
            `(${error instanceof Error ? error.message.split("\n")[0] : String(error)})`,
        );
      }
    }
    return this.sharpModule;
  }

  async prepare(
    image: DecodedImage,
    maxEdge: number,
  ): Promise<{ image: DecodedImage; width: number; height: number }> {
    const sharp = await this.lib();

    // `animated: true` so a pasted GIF keeps its frames. Without it sharp reads
    // only the first one and a reaction GIF silently becomes a still.
    const pipeline = sharp(image.data, { animated: image.mimeType === "image/gif" });
    const meta = await pipeline.metadata();

    // `withoutEnlargement` is the whole reason this is not a plain resize: a small
    // screenshot upscaled to 1600px is bytes spent on invented pixels.
    const resized = pipeline.resize({
      width: maxEdge,
      height: maxEdge,
      fit: "inside",
      withoutEnlargement: true,
    });

    // Re-encoded in its own format rather than normalised to one: a pasted PNG
    // screenshot stays lossless, and a photo stays JPEG instead of ballooning.
    const data = await resized.toBuffer();
    const out = await sharp(data, { animated: image.mimeType === "image/gif" }).metadata();

    return {
      image: { data, mimeType: image.mimeType },
      // `pageHeight` for an animated GIF: `height` there is every frame stacked,
      // so a 10-frame image would otherwise report ten times its real height.
      width: out.width ?? meta.width ?? 0,
      height: out.pageHeight ?? out.height ?? meta.height ?? 0,
    };
  }
}
