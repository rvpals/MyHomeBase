import { describe, expect, it } from "vitest";
import {
  centerCrop,
  clippedFraction,
  laplacianVariance,
  luminanceStats,
  measure,
} from "./metrics";
import type { GrayscaleImage } from "./types";

/** An image built from a function of x and y, so a test can state the pattern directly. */
function build(width: number, height: number, value: (x: number, y: number) => number): GrayscaleImage {
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) pixels[y * width + x] = value(x, y);
  }
  return { width, height, pixels };
}

/** Alternating black and white pixels -- the sharpest pattern that fits in a grid. */
const checkerboard = (size: number) => build(size, size, (x, y) => ((x + y) % 2 === 0 ? 0 : 255));

/** A flat field -- no edges at all. */
const flat = (size: number, level: number) => build(size, size, () => level);

describe("laplacianVariance", () => {
  it("rates a checkerboard far sharper than a flat field", () => {
    expect(laplacianVariance(checkerboard(16))).toBeGreaterThan(
      laplacianVariance(flat(16, 128)) + 1000,
    );
  });

  it("is zero for a flat field, which has no edges", () => {
    expect(laplacianVariance(flat(16, 128))).toBe(0);
  });

  it("rates a soft gradient below a hard edge", () => {
    const gradient = build(16, 16, (x) => x * 16);
    const hardEdge = build(16, 16, (x) => (x < 8 ? 0 : 255));
    expect(laplacianVariance(gradient)).toBeLessThan(laplacianVariance(hardEdge));
  });

  it("returns 0 for an image with no interior pixels", () => {
    expect(laplacianVariance(build(2, 2, () => 255))).toBe(0);
  });
});

describe("centerCrop", () => {
  it("takes the middle half of each dimension", () => {
    const cropped = centerCrop(build(8, 8, () => 100));
    expect(cropped.width).toBe(4);
    expect(cropped.height).toBe(4);
  });

  it("reads the centre, not the corner", () => {
    // Only the middle 4x4 is bright; a crop that drifted would pick up zeros.
    const image = build(8, 8, (x, y) => (x >= 2 && x < 6 && y >= 2 && y < 6 ? 255 : 0));
    expect([...centerCrop(image).pixels].every((value) => value === 255)).toBe(true);
  });

  it("returns the image unchanged when it is too small to crop", () => {
    const tiny = build(4, 4, () => 50);
    expect(centerCrop(tiny)).toBe(tiny);
  });
});

describe("luminanceStats", () => {
  it("reads the mean of a flat field as its level", () => {
    expect(luminanceStats(flat(8, 90).pixels).brightness).toBe(90);
  });

  it("reports zero contrast for a flat field", () => {
    expect(luminanceStats(flat(8, 90).pixels).contrast).toBe(0);
  });

  it("reports high contrast for a half-black, half-white frame", () => {
    const split = build(8, 8, (x) => (x < 4 ? 0 : 255));
    expect(luminanceStats(split.pixels).contrast).toBeCloseTo(127.5, 1);
  });

  it("handles an empty array without dividing by zero", () => {
    expect(luminanceStats(new Uint8Array(0))).toEqual({ brightness: 0, contrast: 0 });
  });
});

describe("clippedFraction", () => {
  it("counts pixels at or below the shadow level", () => {
    const image = build(10, 10, (x) => (x < 2 ? 0 : 128));
    expect(clippedFraction(image.pixels, 5, "below")).toBeCloseTo(0.2, 5);
  });

  it("counts pixels at or above the highlight level", () => {
    const image = build(10, 10, (x) => (x < 3 ? 255 : 128));
    expect(clippedFraction(image.pixels, 250, "above")).toBeCloseTo(0.3, 5);
  });

  it("includes pixels exactly at the level", () => {
    expect(clippedFraction(flat(4, 250).pixels, 250, "above")).toBe(1);
  });

  it("returns 0 for an empty array", () => {
    expect(clippedFraction(new Uint8Array(0), 5, "below")).toBe(0);
  });
});

describe("measure", () => {
  it("reports every metric for one image", () => {
    const metrics = measure(checkerboard(16));
    expect(metrics.sharpness).toBeGreaterThan(0);
    expect(metrics.centerSharpness).toBeGreaterThan(0);
    expect(metrics.brightness).toBeCloseTo(127.5, 0);
    expect(metrics.contrast).toBeGreaterThan(0);
  });

  it("flags an underexposed frame as shadow-clipped", () => {
    const dark = measure(flat(16, 2));
    expect(dark.shadowClipping).toBe(1);
    expect(dark.highlightClipping).toBe(0);
  });

  it("flags an overexposed frame as highlight-clipped", () => {
    const blown = measure(flat(16, 254));
    expect(blown.highlightClipping).toBe(1);
    expect(blown.shadowClipping).toBe(0);
  });
});
