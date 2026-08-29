import { describe, expect, it } from "vitest";
import {
  ICON_TARGET_SIZE,
  detectBackdropColours,
  findContentBox,
  normalizeIconImage,
} from "./normalize-image";
import type { IconImageProcessor } from "./ports";
import type { RawBitmap } from "./types";

/** A blank RGBA canvas. Fully transparent unless a helper paints it. */
function canvas(width: number, height: number): RawBitmap {
  return { data: Buffer.alloc(width * height * 4), width, height };
}

function set(bitmap: RawBitmap, x: number, y: number, r: number, g: number, b: number, a = 255) {
  const i = (y * bitmap.width + x) * 4;
  bitmap.data[i] = r;
  bitmap.data[i + 1] = g;
  bitmap.data[i + 2] = b;
  bitmap.data[i + 3] = a;
}

function fill(bitmap: RawBitmap, r: number, g: number, b: number, a = 255) {
  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < bitmap.width; x++) set(bitmap, x, y, r, g, b, a);
  }
}

/**
 * The classic export artefact: an 8px checkerboard of white and light grey, flattened
 * because JPEG has no alpha channel.
 */
function checkerboard(size: number, cell = 8): RawBitmap {
  const bitmap = canvas(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const light = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
      if (light) set(bitmap, x, y, 255, 255, 255);
      else set(bitmap, x, y, 204, 204, 204);
    }
  }
  return bitmap;
}

/** A solid block of colour in the middle, standing in for the glyph. */
function paintBlock(
  bitmap: RawBitmap,
  left: number,
  top: number,
  size: number,
  colour: [number, number, number] = [20, 30, 200],
) {
  for (let y = top; y < top + size; y++) {
    for (let x = left; x < left + size; x++) set(bitmap, x, y, ...colour);
  }
}

describe("detectBackdropColours", () => {
  it("finds both tones of a flattened checkerboard", () => {
    const found = detectBackdropColours(checkerboard(64));
    expect(found).not.toBeNull();
    expect(found).toHaveLength(2);
  });

  it("finds a single solid backdrop colour", () => {
    const bitmap = canvas(64, 64);
    fill(bitmap, 255, 255, 255);
    paintBlock(bitmap, 20, 20, 24);

    const found = detectBackdropColours(bitmap);
    expect(found).toHaveLength(1);
    expect(found?.[0].r).toBe(255);
  });

  it("finds a solid BLACK backdrop too — white is not the only wrong answer", () => {
    // A black-matted export is just as broken as a white one, on the opposite theme.
    const bitmap = canvas(64, 64);
    fill(bitmap, 0, 0, 0);
    paintBlock(bitmap, 20, 20, 24, [240, 240, 240]);

    expect(detectBackdropColours(bitmap)).toHaveLength(1);
  });

  it("declines an image that already has real transparency", () => {
    // A correctly exported PNG. There is no flattened backdrop to undo, and touching it
    // would be pure risk.
    const bitmap = canvas(64, 64);
    paintBlock(bitmap, 20, 20, 24);

    expect(detectBackdropColours(bitmap)).toBeNull();
  });

  it("declines a photo, whose border is many different colours", () => {
    // The safety property that matters most: a photo used deliberately as an icon must
    // survive untouched rather than having holes punched in it.
    const bitmap = canvas(64, 64);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) set(bitmap, x, y, (x * 7) % 256, (y * 11) % 256, (x + y) % 256);
    }

    expect(detectBackdropColours(bitmap)).toBeNull();
  });

  it("declines artwork that bleeds to the edge", () => {
    // Half red, half blue, edge to edge. Two dominant border colours, but neither is a
    // light neutral — so this is art, not a checkerboard, and only the single dominant
    // colour rule could apply. It must not report two.
    const bitmap = canvas(64, 64);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        if (x < 32) set(bitmap, x, y, 200, 20, 20);
        else set(bitmap, x, y, 20, 20, 200);
      }
    }

    const found = detectBackdropColours(bitmap);
    // Either declines outright, or treats one side as a solid mat — never both colours,
    // which would erase the whole image.
    expect(found === null || found.length === 1).toBe(true);
  });

  it("declines an image too small to judge", () => {
    expect(detectBackdropColours(canvas(4, 4))).toBeNull();
  });
});

describe("findContentBox", () => {
  it("returns a square box around off-centre content", () => {
    const bitmap = canvas(100, 100);
    paintBlock(bitmap, 10, 10, 20);

    const box = findContentBox(bitmap);
    expect(box.width).toBe(box.height);
    expect(box.left).toBeLessThanOrEqual(10);
    expect(box.width).toBeLessThan(100);
  });

  it("stays inside the frame when content hugs a corner", () => {
    // The padding must not push the crop off the canvas — sharp's extract throws on that.
    const bitmap = canvas(50, 50);
    paintBlock(bitmap, 0, 0, 6);

    const box = findContentBox(bitmap);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.left + box.width).toBeLessThanOrEqual(50);
    expect(box.top + box.height).toBeLessThanOrEqual(50);
  });

  it("returns the full frame for an all-transparent image rather than an empty crop", () => {
    const box = findContentBox(canvas(32, 32));
    expect(box).toEqual({ left: 0, top: 0, width: 32, height: 32 });
  });

  it("ignores faint near-transparent fringe left by a JPEG decode", () => {
    const bitmap = canvas(64, 64);
    // Fringe at alpha 10 across the whole canvas, real content in the middle.
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) set(bitmap, x, y, 128, 128, 128, 10);
    }
    paintBlock(bitmap, 26, 26, 12);

    // Honouring the fringe would return the whole frame and defeat the trim.
    expect(findContentBox(bitmap).width).toBeLessThan(64);
  });
});

describe("normalizeIconImage", () => {
  /** Records what it was asked to do, so the pipeline's decisions can be asserted. */
  function fakeProcessor(bitmap: RawBitmap) {
    const calls: { crop?: unknown; size?: number; alphaAtCrop?: number } = {};
    const processor: IconImageProcessor = {
      async decode() {
        return bitmap;
      },
      async encodePng(finalBitmap, crop, size) {
        calls.crop = crop;
        calls.size = size;
        // Sample the alpha at the crop's top-left: 0 proves the backdrop was cleared.
        const i = (crop.top * finalBitmap.width + crop.left) * 4;
        calls.alphaAtCrop = finalBitmap.data[i + 3];
        return Buffer.from("png-bytes");
      },
    };
    return { processor, calls };
  }

  it("strips a checkerboard, trims, and encodes at the target size", async () => {
    const bitmap = checkerboard(128);
    paintBlock(bitmap, 40, 40, 48);

    const { processor, calls } = fakeProcessor(bitmap);
    const result = await normalizeIconImage(processor, Buffer.from("in"));

    expect(result.strippedBackdrop).toBe(true);
    expect(result.trimmed).toBe(true);
    expect(result.mimeType).toBe("image/png");
    expect(result.width).toBe(ICON_TARGET_SIZE);
    expect(calls.size).toBe(ICON_TARGET_SIZE);
    // The former checkerboard is now transparent where the crop starts.
    expect(calls.alphaAtCrop).toBe(0);
  });

  it("clears a checkerboard whose flat tones were smeared by JPEG compression", async () => {
    // The bug this pins: a real 1024px upload came back from JPEG with 38 distinct
    // colours in one row, clustered around 212-215 and 252-255. Clearing at the
    // detection tolerance left a faint grid AND left border pixels opaque, which
    // silently defeated the trim because the content box then reached the frame edge.
    const size = 128;
    const bitmap = canvas(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const light = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
        // Jitter each tone the way lossy compression does. Clamped to 0-255: a raw
        // Buffer wraps on overflow, so an unclamped 254+2 would write 0 and invent a
        // black border the real data never has.
        const jitter = ((x * 7 + y * 13) % 5) - 2;
        const base = light ? 252 : 213;
        const v = Math.min(255, Math.max(0, base + jitter));
        set(bitmap, x, y, v, v, v);
      }
    }
    paintBlock(bitmap, 44, 44, 40);

    const { processor, calls } = fakeProcessor(bitmap);
    const result = await normalizeIconImage(processor, Buffer.from("in"));

    expect(result.strippedBackdrop).toBe(true);
    // Both halves of the original symptom.
    expect(result.trimmed).toBe(true);
    expect(calls.alphaAtCrop).toBe(0);
  });

  it("leaves a correctly exported transparent PNG alone", async () => {
    const bitmap = canvas(128, 128);
    paintBlock(bitmap, 32, 32, 64);

    const { processor } = fakeProcessor(bitmap);
    const result = await normalizeIconImage(processor, Buffer.from("in"));

    expect(result.strippedBackdrop).toBe(false);
    // Still downscaled and trimmed — that part is always worth doing.
    expect(result.width).toBe(ICON_TARGET_SIZE);
  });

  it("does not report a strip for a photo", async () => {
    const bitmap = canvas(64, 64);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) set(bitmap, x, y, (x * 7) % 256, (y * 11) % 256, (x + y) % 256);
    }

    const { processor } = fakeProcessor(bitmap);
    const result = await normalizeIconImage(processor, Buffer.from("in"));

    expect(result.strippedBackdrop).toBe(false);
  });

  it("propagates a decoder failure so the caller can keep the original bytes", async () => {
    const processor: IconImageProcessor = {
      async decode() {
        throw new Error("unsupported image");
      },
      async encodePng() {
        return Buffer.alloc(0);
      },
    };

    await expect(normalizeIconImage(processor, Buffer.from("junk"))).rejects.toThrow(
      /unsupported image/,
    );
  });
});
