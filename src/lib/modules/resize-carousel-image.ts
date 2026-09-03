// Shrinks a carousel graphic to something worth sending over the wire.
//
// The problem this solves: nothing used to resize these. The upload control only
// *rejected* files over `MAX_CAROUSEL_IMAGE_BYTES` (2 MB), so a 3000x3000 photo
// was stored whole and then downloaded whole — to be drawn in a 192px box, or
// 112px on a phone. That is ~100x more pixels than the screen shows, and on a
// home network off the NAS it reads as an image that paints in slowly from the
// top.
//
// Every *decision* is here, as arithmetic over a width and a height; only the
// decode/encode goes through `CarouselImageProcessor`. That split is what lets
// this be tested with a fake port instead of a real image and a native module —
// the same trade `lib/icons/normalize-image.ts` makes.

import type { CarouselImageProcessor } from "./ports";
import type { DecodedImage } from "@/lib/shared/image-upload";

/**
 * The longest edge a stored graphic may have.
 *
 * The carousel draws it at 192px (`sm:h-48 w-48`) and the admin thumbnail at
 * 80px, so 800 leaves headroom for a retina panel and for the tile growing later
 * without anyone having to re-upload.
 */
export const CAROUSEL_IMAGE_MAX_EDGE = 800;

/**
 * WebP quality. 82 is the usual sweet spot for photographic art — visually
 * indistinguishable at this size, and roughly a third the bytes of q95.
 */
export const CAROUSEL_IMAGE_WEBP_QUALITY = 82;

/** What every resized graphic is stored as. */
const WEBP_MIME_TYPE = "image/webp";

/**
 * An animated GIF is passed through untouched.
 *
 * `sharp` flattens one to its first frame, which would silently kill the
 * animation — and unlike an icon (where `lib/icons` accepts that trade because a
 * still frame is still a usable 20px glyph) a carousel graphic is the thing the
 * reader is looking at. Better a large animated GIF than a small broken one.
 */
const PASS_THROUGH_MIME_TYPES = new Set(["image/gif"]);

export interface ResizeCarouselImageResult extends DecodedImage {
  /** False when the image was left exactly as it came in, and why. */
  resized: boolean;
  /** Present when `resized` is false. */
  skippedReason?: "animated-format" | "already-small";
  width: number;
  height: number;
  originalBytes: number;
}

/**
 * Resizes if it is worth resizing, and says so either way.
 *
 * Deliberately *not* throwing when the bytes are already small: the backfill
 * runs over every stored graphic and a no-op has to be an ordinary outcome, not
 * an error to filter out at the call site.
 */
export async function resizeCarouselImage(
  processor: CarouselImageProcessor,
  image: DecodedImage,
  options: { maxEdge?: number; quality?: number } = {},
): Promise<ResizeCarouselImageResult> {
  const maxEdge = options.maxEdge ?? CAROUSEL_IMAGE_MAX_EDGE;
  const quality = options.quality ?? CAROUSEL_IMAGE_WEBP_QUALITY;

  if (PASS_THROUGH_MIME_TYPES.has(image.mimeType)) {
    return {
      ...image,
      resized: false,
      skippedReason: "animated-format",
      width: 0,
      height: 0,
      originalBytes: image.data.length,
    };
  }

  const { width, height } = await processor.probe(image.data);

  // Already inside the box *and* already WebP: re-encoding would only lose
  // another generation of quality for no useful saving. A small PNG still gets
  // converted, because WebP is typically 3-4x smaller for flat art.
  if (width <= maxEdge && height <= maxEdge && image.mimeType === WEBP_MIME_TYPE) {
    return {
      ...image,
      resized: false,
      skippedReason: "already-small",
      width,
      height,
      originalBytes: image.data.length,
    };
  }

  const data = await processor.encodeWebp(image.data, maxEdge, quality);
  const scale = Math.min(1, maxEdge / Math.max(width, height));

  return {
    data,
    mimeType: WEBP_MIME_TYPE,
    resized: true,
    // Rounded the way a scaler does, and floored at 1 so a freakishly thin
    // image can't report a zero edge.
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    originalBytes: image.data.length,
  };
}
