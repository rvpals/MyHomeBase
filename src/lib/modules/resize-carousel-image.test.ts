import { describe, expect, it } from "vitest";
import {
  CAROUSEL_IMAGE_MAX_EDGE,
  resizeCarouselImage,
} from "./resize-carousel-image";
import type { CarouselImageProcessor } from "./ports";

/**
 * A fake processor: it reports whatever dimensions the test asks for and
 * "encodes" to a fixed short buffer. No real image and no `sharp` — which is the
 * whole reason the decisions live outside the adapter.
 */
function fakeProcessor(
  dimensions: { width: number; height: number },
  encoded = Buffer.from("webp-bytes"),
): CarouselImageProcessor & { calls: { maxEdge: number; quality: number }[] } {
  const calls: { maxEdge: number; quality: number }[] = [];
  return {
    calls,
    probe: async () => dimensions,
    encodeWebp: async (_data, maxEdge, quality) => {
      calls.push({ maxEdge, quality });
      return encoded;
    },
  };
}

const bigPng = { data: Buffer.alloc(1_900_000, 7), mimeType: "image/png" };

describe("resizeCarouselImage", () => {
  it("downscales an oversized image and re-encodes it as WebP", async () => {
    const processor = fakeProcessor({ width: 3000, height: 3000 });

    const result = await resizeCarouselImage(processor, bigPng);

    expect(result.resized).toBe(true);
    expect(result.mimeType).toBe("image/webp");
    expect(result.width).toBe(CAROUSEL_IMAGE_MAX_EDGE);
    expect(result.height).toBe(CAROUSEL_IMAGE_MAX_EDGE);
    expect(result.originalBytes).toBe(1_900_000);
    expect(result.data.length).toBeLessThan(result.originalBytes);
  });

  it("keeps the aspect ratio when the image isn't square", async () => {
    const processor = fakeProcessor({ width: 2000, height: 1000 });

    const result = await resizeCarouselImage(processor, bigPng);

    expect(result.width).toBe(800);
    expect(result.height).toBe(400);
  });

  it("never upscales an image that is already smaller than the target", async () => {
    const processor = fakeProcessor({ width: 200, height: 200 });

    const result = await resizeCarouselImage(processor, {
      data: Buffer.from("small"),
      mimeType: "image/webp",
    });

    expect(result.resized).toBe(false);
    expect(result.skippedReason).toBe("already-small");
    expect(result.width).toBe(200);
    expect(processor.calls).toHaveLength(0);
  });

  it("still converts a small PNG, because WebP is much smaller for flat art", async () => {
    const processor = fakeProcessor({ width: 200, height: 200 });

    const result = await resizeCarouselImage(processor, {
      data: Buffer.alloc(50_000),
      mimeType: "image/png",
    });

    expect(result.resized).toBe(true);
    expect(result.mimeType).toBe("image/webp");
  });

  it("passes an animated GIF through rather than flattening it to one frame", async () => {
    const processor = fakeProcessor({ width: 3000, height: 3000 });
    const gif = { data: Buffer.alloc(900_000), mimeType: "image/gif" };

    const result = await resizeCarouselImage(processor, gif);

    expect(result.resized).toBe(false);
    expect(result.skippedReason).toBe("animated-format");
    expect(result.mimeType).toBe("image/gif");
    expect(result.data).toBe(gif.data);
    expect(processor.calls).toHaveLength(0);
  });

  it("honours caller-supplied bounds", async () => {
    const processor = fakeProcessor({ width: 3000, height: 3000 });

    await resizeCarouselImage(processor, bigPng, { maxEdge: 256, quality: 60 });

    expect(processor.calls).toEqual([{ maxEdge: 256, quality: 60 }]);
  });

  it("surfaces an unreadable image rather than storing the bad bytes", async () => {
    const processor: CarouselImageProcessor = {
      probe: async () => {
        throw new Error("Input buffer contains unsupported image format");
      },
      encodeWebp: async () => Buffer.from(""),
    };

    await expect(
      resizeCarouselImage(processor, { data: Buffer.from("nonsense"), mimeType: "image/png" }),
    ).rejects.toThrow(/unsupported image format/);
  });
});
