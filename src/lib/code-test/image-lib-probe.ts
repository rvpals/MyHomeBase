import type { ImageLibInfo, ImageLibProbe, ImageMetadata, TimedPhotoReader } from "./ports";
import type { PhotoFileStore } from "@/lib/journal-photos/ports";

/**
 * The real `ImageLibProbe`, over `sharp`.
 *
 * ## Why the import is lazy
 *
 * Same rule and same reason as `lib/journal-photos/thumbnail-renderer.ts` and
 * `lib/icons/image-processor.ts`: this is reached through `src/lib/wiring.ts`, which
 * every page imports, so a top-level `import sharp from "sharp"` would run the native
 * binding on every render. Deferred, a broken install costs one failed experiment --
 * and the experiment reports it.
 *
 * Loading lazily is also what lets the experiment MEASURE the first-use cost: `load()`
 * times the import the first time and reports `undefined` after that.
 */
export class SharpImageLibProbe implements ImageLibProbe {
  private sharpModule?: (typeof import("sharp"))["default"];

  async load(): Promise<{ ms: number | undefined; info: ImageLibInfo }> {
    let ms: number | undefined;
    if (!this.sharpModule) {
      const startedAt = performance.now();
      try {
        this.sharpModule = (await import("sharp")).default;
      } catch (error) {
        throw new Error(
          `the sharp module failed to load (${
            error instanceof Error ? error.message.split("\n")[0] : String(error)
          })`,
        );
      }
      ms = performance.now() - startedAt;
    }
    const versions = this.sharpModule.versions as { sharp?: string; vips?: string };
    return {
      ms,
      info: {
        version: versions.sharp ?? "unknown",
        detail: versions.vips === undefined ? "" : `libvips ${versions.vips}`,
        platform: process.platform,
        arch: process.arch,
      },
    };
  }

  async metadata(bytes: Uint8Array): Promise<ImageMetadata> {
    const sharp = await this.lib();
    const metadata = await sharp(bytes, { failOn: "none" }).metadata();
    return { width: metadata.width, height: metadata.height, orientation: metadata.orientation };
  }

  async resize(bytes: Uint8Array, longEdge: number): Promise<{ data: Uint8Array; ms: number }> {
    const sharp = await this.lib();
    const startedAt = performance.now();
    const output = await sharp(bytes, { failOn: "none" })
      // Orient from the photo's own EXIF, as a served resize would have to.
      .rotate()
      // `inside`: the LONGER edge becomes `longEdge`.
      .resize(longEdge, longEdge, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    return { data: new Uint8Array(output), ms: performance.now() - startedAt };
  }

  private async lib(): Promise<(typeof import("sharp"))["default"]> {
    await this.load();
    return this.sharpModule!;
  }
}

/**
 * A `TimedPhotoReader` over the archive's read-only store.
 *
 * Built per request rather than held in `deps`, because the store is: the photo root is
 * a setting, read when the request runs (see `photoFileStoreFor` in wiring.ts).
 */
export function createTimedPhotoReader(
  store: PhotoFileStore,
  now: () => number = () => performance.now(),
): TimedPhotoReader {
  return {
    async read(relativePath) {
      const startedAt = now();
      const photo = await store.readPhoto(relativePath);
      if (photo === undefined) return undefined;
      return { data: photo.data, ms: now() - startedAt };
    },

    async stat(relativePath) {
      const startedAt = now();
      const stat = await store.statPhoto(relativePath);
      if (stat === undefined) return undefined;
      return { bytes: stat.bytes, ms: now() - startedAt };
    },

    async readHeader(relativePath, byteCount) {
      const startedAt = now();
      const data = await store.readHeader(relativePath, byteCount);
      if (data === undefined) return undefined;
      return { data, ms: now() - startedAt };
    },
  };
}
