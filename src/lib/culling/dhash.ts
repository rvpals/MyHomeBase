import type { GrayscaleImage } from "./types";

// The perceptual hash used to spot near-identical frames -- a burst, a bracketed
// exposure, the same scene shot twice.
//
// Pure, like `metrics.ts`: it takes the 9x8 grayscale reduction that `analyze.ts`
// produces with sharp, so the bit arithmetic can be tested from a hand-built array.

/** The reduction dHash is computed from: 9 columns x 8 rows, giving 8x8 = 64 bits. */
export const DHASH_WIDTH = 9;
export const DHASH_HEIGHT = 8;

/**
 * A 64-bit difference hash as 16 hex characters.
 *
 * dHash rather than an average hash: it encodes whether each pixel is brighter than
 * the one to its right, so it reads the *gradient* of the image. That makes it
 * indifferent to a uniform change in exposure or white balance -- the same scene
 * brightened by a stop keeps nearly the same hash -- while still separating two
 * genuinely different pictures.
 *
 * Hex rather than a `bigint` so the value survives JSON output and an equality check
 * with no custom serialiser.
 *
 * @param image A 9x8 grayscale reduction of the frame.
 * @returns 16 lowercase hex characters.
 * @throws If the image is not exactly 9x8.
 */
export function differenceHash(image: GrayscaleImage): string {
  if (image.width !== DHASH_WIDTH || image.height !== DHASH_HEIGHT) {
    throw new Error(
      `dHash needs a ${DHASH_WIDTH}x${DHASH_HEIGHT} image, got ${image.width}x${image.height}.`,
    );
  }

  let hex = "";
  // Built a nibble at a time rather than into a 64-bit integer: JavaScript's bitwise
  // operators are 32-bit, so shifting a 64th bit into place would silently wrap.
  let nibble = 0;
  let bitsInNibble = 0;

  for (let y = 0; y < DHASH_HEIGHT; y += 1) {
    for (let x = 0; x < DHASH_WIDTH - 1; x += 1) {
      const index = y * DHASH_WIDTH + x;
      const bit = image.pixels[index] > image.pixels[index + 1] ? 1 : 0;

      nibble = (nibble << 1) | bit;
      bitsInNibble += 1;

      if (bitsInNibble === 4) {
        hex += nibble.toString(16);
        nibble = 0;
        bitsInNibble = 0;
      }
    }
  }

  return hex;
}

/**
 * How many bits two hashes differ in -- the Hamming distance.
 *
 * Compared a nibble at a time off a lookup table, which is both exact for 64 bits and
 * faster than parsing two `bigint`s per comparison. That matters because grouping is
 * quadratic: a 400-photo folder makes ~80,000 of these calls.
 *
 * @param left A 16-character hex hash.
 * @param right A 16-character hex hash.
 * @returns The number of differing bits, 0-64.
 * @throws If the two hashes are different lengths.
 */
export function hammingDistance(left: string, right: string): number {
  if (left.length !== right.length) {
    throw new Error(`Cannot compare hashes of different lengths: ${left.length} vs ${right.length}.`);
  }

  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] === right[index]) continue;
    const difference = parseInt(left[index], 16) ^ parseInt(right[index], 16);
    distance += NIBBLE_BIT_COUNT[difference];
  }

  return distance;
}

/** Set bits in each hex nibble, 0x0 through 0xf. */
const NIBBLE_BIT_COUNT = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];
