// Shrinks a recipe picture before it is stored.
//
// The problem this solves: nothing used to resize these. `setRecipeImage` only
// *rejected* files over `MAX_RECIPE_PICTURE_BYTES`, so a 1.9 MB phone photo was
// stored whole and then downloaded whole — to be drawn in a 36px grid thumbnail,
// or 160px in the record view. That is thousands of times more pixels than the
// screen shows, and off the NAS on a home network it reads as a list that fills
// in slowly.
//
// ## Why this file is thin
//
// The carousel solved exactly this problem first, and `resizeCarouselImage` is
// already generic over `maxEdge` and `quality` — the port it takes is a bare
// probe/encode pair with nothing carousel-specific in it. So this module
// contributes the two *numbers* a recipe picture wants and delegates the work,
// rather than being a second copy of the same arithmetic that could drift from
// it. If the shared resizer ever grows a carousel-only assumption, that is the
// moment to fork it, not before.

import {
  CAROUSEL_IMAGE_WEBP_QUALITY,
  resizeCarouselImage,
  type CarouselImageProcessor,
  type ResizeCarouselImageResult,
} from "@/lib/modules";
import type { DecodedImage } from "@/lib/shared/image-upload";

/**
 * The longest edge a stored recipe picture may have.
 *
 * The grid thumbnail is 36px and the record view is 160px, so 800 is generous —
 * deliberately. It is the same number the carousel uses, and it leaves room for
 * the viewer growing into a full-bleed photograph later without anyone having to
 * re-upload their recipe box. A 2 MB upload lands around 60-100 KB here.
 */
export const RECIPE_PICTURE_MAX_EDGE = 800;

/**
 * WebP quality. The carousel's 82, reused rather than re-picked: both are
 * photographic art shown at a few hundred pixels, and two different numbers for
 * the same job would be a difference with no reason behind it.
 */
export const RECIPE_PICTURE_WEBP_QUALITY = CAROUSEL_IMAGE_WEBP_QUALITY;

/**
 * Resizes a recipe picture if it is worth resizing, and says so either way.
 *
 * Non-throwing on a no-op for the same reason the carousel's is: "this image was
 * already small enough" is an ordinary outcome, not an error the call site has to
 * filter out. An animated GIF passes through untouched — `sharp` would flatten it
 * to its first frame, and a broken animation is worse than a large one.
 */
export async function resizeRecipePicture(
  processor: CarouselImageProcessor,
  image: DecodedImage,
): Promise<ResizeCarouselImageResult> {
  return resizeCarouselImage(processor, image, {
    maxEdge: RECIPE_PICTURE_MAX_EDGE,
    quality: RECIPE_PICTURE_WEBP_QUALITY,
  });
}
