import { describe, expect, it } from "vitest";
import { readJpegSize } from "./jpeg-size";

// The parser has to be right about the awkward cases, not just the happy one. A wrong
// answer here does not fail loudly -- it shows up as a photograph silently missing from
// (or wrongly appearing in) a Magic List that asked for a minimum resolution, with
// nothing in a log to say why. A malformed file must come back `undefined`, never a
// confident wrong number and never a hang.

/**
 * A minimal JPEG carrying one frame header, for the parser to walk.
 *
 * Built rather than fixtured because the interesting cases are structural (which
 * marker, what comes before it, where the buffer stops) and a real photograph would
 * make each of those a 6MB file that hides the one detail under test.
 */
function buildJpeg(options: {
  width: number;
  height: number;
  /** Which SOF marker to use. `0xc0` baseline by default, `0xc2` for progressive. */
  frameMarker?: number;
  /** Segments to emit before the frame, as `[marker, payloadLength]`. */
  leadingSegments?: [number, number][];
  /** Emit `FF` padding bytes before the frame marker, which is legal. */
  withFillBytes?: boolean;
}): Uint8Array {
  const { width, height, frameMarker = 0xc0, leadingSegments = [], withFillBytes } = options;
  const bytes: number[] = [0xff, 0xd8];

  for (const [marker, payloadLength] of leadingSegments) {
    // Length includes its own two bytes, so the payload is `payloadLength` long.
    const length = payloadLength + 2;
    bytes.push(0xff, marker, (length >> 8) & 0xff, length & 0xff);
    for (let i = 0; i < payloadLength; i += 1) bytes.push(0x00);
  }

  if (withFillBytes) bytes.push(0xff, 0xff);

  // SOF: length (8 for a single-component frame), precision, height, width, components.
  bytes.push(0xff, frameMarker, 0x00, 0x0b, 0x08);
  bytes.push((height >> 8) & 0xff, height & 0xff);
  bytes.push((width >> 8) & 0xff, width & 0xff);
  bytes.push(0x01, 0x01, 0x11, 0x00);

  return new Uint8Array(bytes);
}

describe("readJpegSize", () => {
  it("reads the dimensions from a baseline frame", () => {
    expect(readJpegSize(buildJpeg({ width: 1920, height: 1080 }))).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it("reads a progressive frame", () => {
    // FFC2. Phones shoot these routinely; skipping the marker would report every such
    // photograph as unmeasurable and quietly drop it from any resolution criterion.
    expect(readJpegSize(buildJpeg({ width: 4032, height: 3024, frameMarker: 0xc2 }))).toEqual({
      width: 4032,
      height: 3024,
    });
  });

  it("does not swap width and height", () => {
    // The one thing in the SOF layout that is easy to get backwards: height comes
    // FIRST. A square test picture would pass either way, so this one is deliberately
    // oblong and asserts both fields.
    const size = readJpegSize(buildJpeg({ width: 800, height: 600 }));
    expect(size?.width).toBe(800);
    expect(size?.height).toBe(600);
  });

  it("reports a portrait frame as stored, without applying EXIF orientation", () => {
    // A phone portrait is often a landscape frame plus a "rotate me" tag. The stored
    // numbers are the right answer for "how many real pixels is this?", which is the
    // question a resolution criterion asks -- see the note in jpeg-size.ts.
    expect(readJpegSize(buildJpeg({ width: 4032, height: 3024 }))).toEqual({
      width: 4032,
      height: 3024,
    });
  });

  it("skips APP and quantisation segments to find the frame", () => {
    // The realistic layout: JFIF APP0, then a big EXIF APP1, then the frame.
    const jpeg = buildJpeg({
      width: 1600,
      height: 1200,
      leadingSegments: [
        [0xe0, 14],
        [0xe1, 2000],
        [0xdb, 65],
      ],
    });
    expect(readJpegSize(jpeg)).toEqual({ width: 1600, height: 1200 });
  });

  it("skips FF fill bytes before a marker", () => {
    expect(readJpegSize(buildJpeg({ width: 640, height: 480, withFillBytes: true }))).toEqual({
      width: 640,
      height: 480,
    });
  });

  it("is not fooled by a Huffman table, which shares the FFCn shape", () => {
    // FFC4 looks like a frame marker and is not one. Reading it as a frame would take
    // two unrelated payload bytes and report a confident, wrong size -- so the real
    // frame after it must be the one that answers.
    const jpeg = buildJpeg({
      width: 1024,
      height: 768,
      leadingSegments: [[0xc4, 30]],
    });
    expect(readJpegSize(jpeg)).toEqual({ width: 1024, height: 768 });
  });

  it("returns undefined for bytes that are not a JPEG", () => {
    // A PNG header. Without the SOI check its bytes would be walked as segment
    // lengths, which is how a parser wanders off the end of a buffer.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(readJpegSize(png)).toBeUndefined();
  });

  it("returns undefined for an empty buffer", () => {
    expect(readJpegSize(new Uint8Array())).toBeUndefined();
  });

  it("returns undefined when the buffer stops before the frame header", () => {
    // The partial-read case this parser exists for: a header read that ended mid-file
    // with the frame still ahead of it. Must be reported as unknown, not guessed at.
    const full = buildJpeg({ width: 1920, height: 1080, leadingSegments: [[0xe1, 500]] });
    expect(readJpegSize(full.slice(0, 200))).toBeUndefined();
  });

  it("returns undefined when the frame header itself is truncated", () => {
    // Buffer ends between the SOF marker and its height/width bytes.
    const full = buildJpeg({ width: 1920, height: 1080 });
    expect(readJpegSize(full.slice(0, full.length - 6))).toBeUndefined();
  });

  it("returns undefined rather than looping on a zero segment length", () => {
    // A length below 2 cannot include its own field. The walk cannot advance past it,
    // so this is the malformed input that would hang a parser that just kept going.
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0x00, 0x00]);
    expect(readJpegSize(jpeg)).toBeUndefined();
  });

  it("returns undefined when a frame declares a zero dimension", () => {
    // Reported as unknown rather than as a 0x0 picture, which would quietly satisfy
    // every "no maximum" criterion.
    expect(readJpegSize(buildJpeg({ width: 0, height: 1080 }))).toBeUndefined();
    expect(readJpegSize(buildJpeg({ width: 1920, height: 0 }))).toBeUndefined();
  });

  it("returns undefined when scan data begins before any frame", () => {
    // FFDA. Past it the bytes are compressed pixels, and walking them as markers is
    // how a parser reports a random number as a resolution.
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 1, 2, 3, 4, 5, 6]);
    expect(readJpegSize(jpeg)).toBeUndefined();
  });

  it("handles the largest dimensions a JPEG can express", () => {
    // 16-bit fields, so 65535 is the ceiling. Shifting into a signed byte would wrap
    // this to a negative and fail every minimum-resolution test.
    expect(readJpegSize(buildJpeg({ width: 65535, height: 65535 }))).toEqual({
      width: 65535,
      height: 65535,
    });
  });
});
