import sharp from "sharp";
import type { PhotoRootCheck } from "../journal-photos";
import type { CullingImageStore } from "./ports";

// Synthetic images for the integration test, and an in-memory store to serve them.
//
// Generated rather than committed as binary fixtures: the assertions are about
// ORDERING -- sharp beats blurred, exposed beats blown -- and a generated pair makes
// the difference between them explicit in code rather than hidden in a .jpg nobody
// can diff. This file is test support and is not exported from `index.ts`.
//
// A real encode, not a hand-built pixel array, because these tests are the only place
// the sharp decode path in `analyze.ts` is exercised at all.

/** A sharp checkerboard: the highest-frequency pattern that fits, so maximum sharpness. */
export async function checkerboardJpeg(size = 256, squarePixels = 8): Promise<Uint8Array> {
  const pixels = Buffer.alloc(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const isLight =
        (Math.floor(x / squarePixels) + Math.floor(y / squarePixels)) % 2 === 0;
      pixels[y * size + x] = isLight ? 230 : 25;
    }
  }

  return encode(pixels, size);
}

/** The same checkerboard put heavily out of focus. */
export async function blurredCheckerboardJpeg(size = 256, squarePixels = 8): Promise<Uint8Array> {
  const sharpSource = await checkerboardJpeg(size, squarePixels);
  // Sigma well above the square size, so the pattern is destroyed rather than softened.
  const blurred = await sharp(Buffer.from(sharpSource)).blur(12).jpeg({ quality: 92 }).toBuffer();
  return new Uint8Array(blurred);
}

/** A checkerboard crushed into the bottom of the range -- detail present, exposure wrong. */
export async function underexposedJpeg(size = 256): Promise<Uint8Array> {
  const pixels = Buffer.alloc(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      pixels[y * size + x] = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0 ? 6 : 0;
    }
  }
  return encode(pixels, size);
}

/** A checkerboard pushed to the top of the range -- blown highlights. */
export async function overexposedJpeg(size = 256): Promise<Uint8Array> {
  const pixels = Buffer.alloc(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      pixels[y * size + x] = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0 ? 255 : 251;
    }
  }
  return encode(pixels, size);
}

/**
 * A near-identical copy of an image: re-encoded at a different quality, with one
 * corner nudged.
 *
 * What a duplicate actually looks like in an archive -- the same scene a moment later,
 * or the same file saved twice -- rather than a byte-identical copy, which any
 * checksum would catch without needing a perceptual hash.
 */
export async function nearDuplicateOf(source: Uint8Array): Promise<Uint8Array> {
  const nudged = await sharp(Buffer.from(source))
    .composite([
      {
        input: {
          create: { width: 12, height: 12, channels: 3, background: { r: 128, g: 128, b: 128 } },
        },
        top: 0,
        left: 0,
      },
    ])
    .jpeg({ quality: 70 })
    .toBuffer();
  return new Uint8Array(nudged);
}

/** Encodes a single-channel buffer as a JPEG. */
async function encode(pixels: Buffer, size: number): Promise<Uint8Array> {
  const jpeg = await sharp(pixels, { raw: { width: size, height: size, channels: 1 } })
    .jpeg({ quality: 95 })
    .toBuffer();
  return new Uint8Array(jpeg);
}

/**
 * An in-memory `CullingImageStore` over a map of name to bytes.
 *
 * Keeps the integration test off the filesystem entirely, so it cannot touch the real
 * archive and does not depend on a temp directory.
 */
export class FakeCullingImageStore implements CullingImageStore {
  constructor(
    private readonly files: Map<string, Uint8Array>,
    private readonly undecodable: string[] = [],
    private readonly rootCheck: PhotoRootCheck = { kind: "ok", path: "/fake/root" },
  ) {}

  async checkRoot(): Promise<PhotoRootCheck> {
    return this.rootCheck;
  }

  async listImageNames(): Promise<string[]> {
    return [...this.files.keys()].sort((left, right) => left.localeCompare(right));
  }

  async listUndecodableNames(): Promise<string[]> {
    return [...this.undecodable];
  }

  async readImage(relativePath: string): Promise<Uint8Array | undefined> {
    return this.files.get(relativePath.split("/").pop() ?? "");
  }
}
