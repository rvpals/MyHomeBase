import type { IconOverride, IconOverrideImage, RawBitmap } from "./types";

/** One override on its way to storage. Bytes are already decoded and sanitized. */
export interface IconOverrideWrite {
  slotId: string;
  setId: string;
  svgBody?: string;
  svgWidth?: number;
  svgHeight?: number;
  imageData?: Buffer;
  imageMimeType?: string;
  updatedAt: string;
}

// The use-cases depend on THIS interface, not on a concrete database.
export interface IconOverridesRepository {
  /**
   * Every override for one icon set, without the raster BLOBs.
   *
   * Read on every page render (the root layout hands the map to the provider), so it
   * must not drag image bytes along — the serving route fetches those one at a time.
   */
  listForSet(setId: string): IconOverride[];
  getImage(slotId: string, setId: string): IconOverrideImage | undefined;
  /**
   * Every raster override across every set, WITH its bytes.
   *
   * Only the re-normalise maintenance command uses this — it is the one caller that
   * genuinely needs all the blobs at once. Nothing on a page-render path may call it.
   */
  listAllImages(): { slotId: string; setId: string; data: Buffer; mimeType: string }[];
  upsert(override: IconOverrideWrite): void;
  remove(slotId: string, setId: string): void;
}

/**
 * Pixel work, behind a port.
 *
 * `src/lib/` may not import `sharp` — it is a native module, and the boundary check aside,
 * a use-case that reaches for one is a use-case that can't be tested without it. So the
 * *decisions* (is this a flattened checkerboard? where does the artwork actually end?)
 * live in `normalize-image.ts` as arithmetic over a plain pixel array, and only the
 * decode/encode crosses this line.
 */
export interface IconImageProcessor {
  /** Decodes to straight RGBA. Throws if the bytes are not a readable image. */
  decode(data: Buffer): Promise<RawBitmap>;
  /**
   * Re-encodes RGBA as PNG, cropped to `crop` and scaled so its longest side is `size`.
   * PNG because it is the only format in the allowlist that carries alpha.
   */
  encodePng(
    bitmap: RawBitmap,
    crop: { left: number; top: number; width: number; height: number },
    size: number,
  ): Promise<Buffer>;
}
