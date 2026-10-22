import { CULLING_CONFIG } from "./config";
import type { GrayscaleImage, PhotoMetrics } from "./types";

// The measurements, as pure functions over a grayscale pixel array.
//
// Deliberately free of `sharp`: decoding lives in `analyze.ts` and every *decision*
// lives here, which is the same split `lib/icons/image-processor.ts` uses and for the
// same reason — it lets the interesting logic be tested with a hand-built 8x8 array
// instead of a real image and a native module.

/**
 * Every metric for one grayscale image.
 *
 * @param image Decoded grayscale pixels, already downsampled by `analyze.ts`.
 * @returns The absolute measurements; comparison happens in `score.ts`.
 */
export function measure(image: GrayscaleImage): PhotoMetrics {
  const { brightness, contrast } = luminanceStats(image.pixels);

  return {
    sharpness: laplacianVariance(image),
    centerSharpness: laplacianVariance(centerCrop(image)),
    brightness,
    contrast,
    shadowClipping: clippedFraction(image.pixels, CULLING_CONFIG.exposure.shadowLevel, "below"),
    highlightClipping: clippedFraction(
      image.pixels,
      CULLING_CONFIG.exposure.highlightLevel,
      "above",
    ),
  };
}

/**
 * Variance of the Laplacian — the standard focus measure.
 *
 * The 4-neighbour Laplacian kernel responds to intensity *changes*, so a sharp edge
 * produces a large value and a blurred one a small value. Taking the variance of that
 * response over the frame gives one number per image: high for a crisp picture,
 * near-zero for a smooth, out-of-focus one.
 *
 * Border pixels are skipped rather than clamped or mirrored. A 1px border of invented
 * edge response on a 1024px frame would be noise in the result, and skipping is both
 * cheaper and honest about what was measured.
 *
 * Returns 0 for an image too small to have an interior.
 *
 * @param image Grayscale pixels.
 * @returns Variance of the Laplacian response. Higher is sharper.
 */
export function laplacianVariance(image: GrayscaleImage): number {
  const { width, height, pixels } = image;
  if (width < 3 || height < 3) return 0;

  // Welford's method rather than summing squares: a 1024x1024 frame is a million
  // samples whose squared responses overflow a naive accumulator's precision long
  // before the mean does.
  let count = 0;
  let mean = 0;
  let sumOfSquaredDeltas = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const response =
        4 * pixels[index] -
        pixels[index - 1] -
        pixels[index + 1] -
        pixels[index - width] -
        pixels[index + width];

      count += 1;
      const delta = response - mean;
      mean += delta / count;
      sumOfSquaredDeltas += delta * (response - mean);
    }
  }

  return count === 0 ? 0 : sumOfSquaredDeltas / count;
}

/**
 * The centre 50% of a frame by linear dimension — a quarter of the area.
 *
 * Measured separately because a portrait with a deliberately blurred background is
 * exactly the picture worth keeping, and a whole-frame sharpness reading would rank it
 * alongside a genuinely out-of-focus shot.
 *
 * @param image The full frame.
 * @returns A copied sub-image. Returns the input unchanged when it is too small to crop.
 */
export function centerCrop(image: GrayscaleImage): GrayscaleImage {
  const { width, height, pixels } = image;
  const cropWidth = Math.floor(width / 2);
  const cropHeight = Math.floor(height / 2);
  if (cropWidth < 3 || cropHeight < 3) return image;

  const left = Math.floor((width - cropWidth) / 2);
  const top = Math.floor((height - cropHeight) / 2);
  const cropped = new Uint8Array(cropWidth * cropHeight);

  for (let y = 0; y < cropHeight; y += 1) {
    const sourceStart = (top + y) * width + left;
    cropped.set(pixels.subarray(sourceStart, sourceStart + cropWidth), y * cropWidth);
  }

  return { width: cropWidth, height: cropHeight, pixels: cropped };
}

/**
 * Mean and standard deviation of luminance.
 *
 * The mean is the exposure reading; the standard deviation is the contrast reading — a
 * flat, hazy frame has a narrow spread whatever its average brightness.
 *
 * @param pixels Grayscale bytes.
 * @returns Mean brightness and standard-deviation contrast, both 0 for an empty array.
 */
export function luminanceStats(pixels: Uint8Array): {
  brightness: number;
  contrast: number;
} {
  if (pixels.length === 0) return { brightness: 0, contrast: 0 };

  let sum = 0;
  for (const value of pixels) sum += value;
  const brightness = sum / pixels.length;

  let sumOfSquaredDeltas = 0;
  for (const value of pixels) {
    const delta = value - brightness;
    sumOfSquaredDeltas += delta * delta;
  }

  return { brightness, contrast: Math.sqrt(sumOfSquaredDeltas / pixels.length) };
}

/**
 * The fraction of pixels sitting at one extreme of the range.
 *
 * Inclusive at the level on purpose: a pixel *at* 255 is as blown as one above it, and
 * 255 is where a clipped highlight actually lands.
 *
 * @param pixels Grayscale bytes.
 * @param level The threshold value.
 * @param direction Whether to count pixels at or below, or at or above, the level.
 * @returns A fraction between 0 and 1.
 */
export function clippedFraction(
  pixels: Uint8Array,
  level: number,
  direction: "below" | "above",
): number {
  if (pixels.length === 0) return 0;

  let clipped = 0;
  for (const value of pixels) {
    if (direction === "below" ? value <= level : value >= level) clipped += 1;
  }

  return clipped / pixels.length;
}
