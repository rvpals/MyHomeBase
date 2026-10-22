import { describe, expect, it } from "vitest";
import { DHASH_HEIGHT, DHASH_WIDTH, differenceHash, hammingDistance } from "./dhash";
import type { GrayscaleImage } from "./types";

/** A 9x8 reduction built from a function, the shape `differenceHash` requires. */
function reduction(value: (x: number, y: number) => number): GrayscaleImage {
  const pixels = new Uint8Array(DHASH_WIDTH * DHASH_HEIGHT);
  for (let y = 0; y < DHASH_HEIGHT; y += 1) {
    for (let x = 0; x < DHASH_WIDTH; x += 1) pixels[y * DHASH_WIDTH + x] = value(x, y);
  }
  return { width: DHASH_WIDTH, height: DHASH_HEIGHT, pixels };
}

describe("differenceHash", () => {
  it("produces 16 hex characters, one per nibble of 64 bits", () => {
    const hash = differenceHash(reduction((x) => x * 20));
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is all zeroes when every pixel is brighter to its right", () => {
    // Each pixel is DARKER than its right neighbour, so no comparison sets a bit.
    expect(differenceHash(reduction((x) => x * 20))).toBe("0".repeat(16));
  });

  it("is all ones when every pixel is darker to its right", () => {
    expect(differenceHash(reduction((x) => 200 - x * 20))).toBe("f".repeat(16));
  });

  it("is unchanged by a uniform brightness shift, which is the point of a gradient hash", () => {
    const base = reduction((x, y) => 40 + ((x * 7 + y * 13) % 60));
    const brighter = reduction((x, y) => 40 + ((x * 7 + y * 13) % 60) + 30);
    expect(differenceHash(brighter)).toBe(differenceHash(base));
  });

  it("differs for two genuinely different patterns", () => {
    const left = differenceHash(reduction((x) => x * 20));
    const right = differenceHash(reduction((x) => 200 - x * 20));
    expect(left).not.toBe(right);
  });

  it("rejects an image that is not the expected reduction", () => {
    const wrongSize = { width: 8, height: 8, pixels: new Uint8Array(64) };
    expect(() => differenceHash(wrongSize)).toThrow(/9x8/);
  });
});

describe("hammingDistance", () => {
  it("is 0 for identical hashes", () => {
    expect(hammingDistance("0123456789abcdef", "0123456789abcdef")).toBe(0);
  });

  it("is 64 for complementary hashes", () => {
    expect(hammingDistance("0".repeat(16), "f".repeat(16))).toBe(64);
  });

  it("counts single differing bits", () => {
    // 0x1 vs 0x0 differs in one bit; the rest of the string matches.
    expect(hammingDistance("1000000000000000", "0000000000000000")).toBe(1);
  });

  it("counts bits within a nibble rather than whole characters", () => {
    // 0x7 (0111) vs 0x0 (0000) is three bits, not one character.
    expect(hammingDistance("7000000000000000", "0000000000000000")).toBe(3);
  });

  it("rejects hashes of different lengths rather than comparing a prefix", () => {
    expect(() => hammingDistance("0123", "0123456789abcdef")).toThrow(/different lengths/);
  });
});
