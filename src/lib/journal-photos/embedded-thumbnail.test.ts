import { describe, expect, it } from "vitest";
import { orientationTransform, readEmbeddedThumbnail } from "./embedded-thumbnail";
import { FAKE_PREVIEW, buildJpegWithPreview } from "./embedded-thumbnail.fixture";
import { buildJpegWithExif } from "./exif.fixture";

describe("readEmbeddedThumbnail", () => {
  it("returns the preview bytes from IFD1, upright when there is no orientation tag", () => {
    const result = readEmbeddedThumbnail(buildJpegWithPreview());
    expect(result).toBeDefined();
    expect([...result!.jpeg]).toEqual(FAKE_PREVIEW);
    expect(result!.orientation).toBe(1);
  });

  it("reads big-endian (Motorola) files the same way", () => {
    const result = readEmbeddedThumbnail(buildJpegWithPreview({ bigEndian: true, orientation: 6 }));
    expect([...result!.jpeg]).toEqual(FAKE_PREVIEW);
    expect(result!.orientation).toBe(6);
  });

  it("carries the original's orientation so a portrait preview can be turned", () => {
    expect(readEmbeddedThumbnail(buildJpegWithPreview({ orientation: 8 }))!.orientation).toBe(8);
  });

  it("treats an out-of-range orientation as upright", () => {
    expect(readEmbeddedThumbnail(buildJpegWithPreview({ orientation: 42 }))!.orientation).toBe(1);
  });

  it("finds nothing when there is no IFD1", () => {
    expect(readEmbeddedThumbnail(buildJpegWithPreview({ withoutIfd1: true }))).toBeUndefined();
  });

  it("finds nothing in a file with EXIF but no preview tags", () => {
    expect(readEmbeddedThumbnail(buildJpegWithExif({ dateTimeOriginal: "2019:06:09 14:35:01" }))).toBeUndefined();
  });

  it("finds nothing in a file with no EXIF at all", () => {
    expect(readEmbeddedThumbnail(buildJpegWithExif({ withoutExif: true }))).toBeUndefined();
  });

  it("refuses a length that runs past the bytes read", () => {
    expect(readEmbeddedThumbnail(buildJpegWithPreview({ lengthOverride: 5000 }))).toBeUndefined();
  });

  it("refuses preview bytes that are not a JPEG", () => {
    expect(readEmbeddedThumbnail(buildJpegWithPreview({ thumbnail: [1, 2, 3, 4, 5, 6] }))).toBeUndefined();
  });

  it("finds nothing in bytes that are not a JPEG", () => {
    expect(readEmbeddedThumbnail(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeUndefined();
  });
});

describe("orientationTransform", () => {
  it("needs nothing for an upright or unknown orientation", () => {
    expect(orientationTransform(1)).toBeUndefined();
    expect(orientationTransform(0)).toBeUndefined();
    expect(orientationTransform(9)).toBeUndefined();
  });

  it("turns a portrait phone photo (6) a quarter clockwise", () => {
    expect(orientationTransform(6)).toEqual({ rotate: 90, flop: false, flip: false });
  });

  it("covers the remaining rotations and mirrors", () => {
    expect(orientationTransform(2)).toEqual({ rotate: 0, flop: true, flip: false });
    expect(orientationTransform(3)).toEqual({ rotate: 180, flop: false, flip: false });
    expect(orientationTransform(4)).toEqual({ rotate: 0, flop: false, flip: true });
    expect(orientationTransform(5)).toEqual({ rotate: 90, flop: true, flip: false });
    expect(orientationTransform(7)).toEqual({ rotate: 270, flop: true, flip: false });
    expect(orientationTransform(8)).toEqual({ rotate: 270, flop: false, flip: false });
  });
});
