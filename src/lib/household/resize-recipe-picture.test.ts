import { describe, expect, it } from "vitest";
import type { CarouselImageProcessor } from "@/lib/modules";
import {
  RECIPE_PICTURE_MAX_EDGE,
  RECIPE_PICTURE_WEBP_QUALITY,
  resizeRecipePicture,
} from "./resize-recipe-picture";

/**
 * A fake processor, recording what it was asked for.
 *
 * The whole point of the port is that this test needs neither `sharp` nor a real
 * image file — the same trade `resize-carousel-image.test.ts` makes.
 */
function fakeProcessor(
  width: number,
  height: number,
): CarouselImageProcessor & { calls: { maxEdge: number; quality: number }[] } {
  const calls: { maxEdge: number; quality: number }[] = [];
  return {
    calls,
    async probe() {
      return { width, height };
    },
    async encodeWebp(_data, maxEdge, quality) {
      calls.push({ maxEdge, quality });
      return Buffer.from("resized-bytes");
    },
  };
}

const bigJpeg = { data: Buffer.from("x".repeat(4096)), mimeType: "image/jpeg" };

describe("resizeRecipePicture", () => {
  it("shrinks an oversized photo to WebP inside the target box", async () => {
    const processor = fakeProcessor(3000, 2000);

    const result = await resizeRecipePicture(processor, bigJpeg);

    expect(result.resized).toBe(true);
    expect(result.mimeType).toBe("image/webp");
    expect(result.data).toEqual(Buffer.from("resized-bytes"));
    // The long edge lands exactly on the cap and the short edge keeps the
    // aspect ratio — 3000x2000 is 3:2, so 800x533.
    expect(result.width).toBe(RECIPE_PICTURE_MAX_EDGE);
    expect(result.height).toBe(533);
    // The recipe module's numbers reached the encoder, not the carousel's
    // defaults — this is the one thing this thin wrapper actually contributes.
    expect(processor.calls).toEqual([
      { maxEdge: RECIPE_PICTURE_MAX_EDGE, quality: RECIPE_PICTURE_WEBP_QUALITY },
    ]);
  });

  it("never upscales a picture that is already smaller than the box", async () => {
    const processor = fakeProcessor(320, 240);

    const result = await resizeRecipePicture(processor, bigJpeg);

    // Still re-encoded (a JPEG becomes WebP for the bytes), but the reported
    // size is the original — a 320px photo must not be blown up to 800px.
    expect(result.width).toBe(320);
    expect(result.height).toBe(240);
  });

  it("passes an animated GIF through untouched", async () => {
    const gif = { data: Buffer.from("gif-bytes"), mimeType: "image/gif" };
    const processor = fakeProcessor(3000, 3000);

    const result = await resizeRecipePicture(processor, gif);

    // Flattening a GIF to its first frame would silently kill the animation, so
    // a large animated picture is preferred to a small broken one.
    expect(result.resized).toBe(false);
    expect(result.skippedReason).toBe("animated-format");
    expect(result.data).toEqual(gif.data);
    expect(result.mimeType).toBe("image/gif");
    expect(processor.calls).toEqual([]);
  });

  it("surfaces a processor that cannot read the image", async () => {
    const processor: CarouselImageProcessor = {
      async probe() {
        throw new Error("That image's dimensions could not be read.");
      },
      async encodeWebp() {
        throw new Error("should not be reached");
      },
    };

    await expect(resizeRecipePicture(processor, bigJpeg)).rejects.toThrow(
      /dimensions could not be read/,
    );
  });
});
