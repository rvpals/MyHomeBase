import { describe, expect, it } from "vitest";
import { buildJpegWithExif } from "./exif.fixture";
import { parseExifDate, readExifDate } from "./exif";

// The parser has to be right about the awkward cases, not just the happy one: every
// failure mode here shows up as a photo silently missing from (or wrongly appearing
// in) a journal entry's card, with nothing in a log to say why.

describe("readExifDate", () => {
  it("reads DateTimeOriginal from a little-endian file", () => {
    const jpeg = buildJpegWithExif({ dateTimeOriginal: "2019:06:09 14:35:01" });
    expect(readExifDate(jpeg)).toBe("2019-06-09");
  });

  it("reads DateTimeOriginal from a big-endian file", () => {
    // Motorola byte order -- Canon and some scanners write this. Getting it wrong
    // does not fail loudly, it reads every number byte-swapped.
    const jpeg = buildJpegWithExif({ dateTimeOriginal: "2019:06:09 14:35:01", bigEndian: true });
    expect(readExifDate(jpeg)).toBe("2019-06-09");
  });

  it("finds EXIF behind a leading JFIF APP0 segment", () => {
    const jpeg = buildJpegWithExif({
      dateTimeOriginal: "2019:06:09 14:35:01",
      withLeadingApp0: true,
    });
    expect(readExifDate(jpeg)).toBe("2019-06-09");
  });

  it("prefers DateTimeOriginal over the other timestamps", () => {
    // An edited photo carries a later DateTime; the shutter time is the answer.
    const jpeg = buildJpegWithExif({
      dateTimeOriginal: "2019:06:09 14:35:01",
      dateTimeDigitized: "2019:06:10 01:00:00",
      dateTime: "2023:01:01 09:00:00",
    });
    expect(readExifDate(jpeg)).toBe("2019-06-09");
  });

  it("falls back to DateTimeDigitized, then to DateTime", () => {
    expect(readExifDate(buildJpegWithExif({ dateTimeDigitized: "2019:06:09 14:35:01" }))).toBe(
      "2019-06-09",
    );
    expect(readExifDate(buildJpegWithExif({ dateTime: "2019:06:09 14:35:01" }))).toBe("2019-06-09");
  });

  it("returns undefined for a JPEG with no EXIF segment", () => {
    expect(readExifDate(buildJpegWithExif({ withoutExif: true }))).toBeUndefined();
  });

  it("returns undefined for an EXIF block carrying no date tag", () => {
    expect(readExifDate(buildJpegWithExif({}))).toBeUndefined();
  });

  it("returns undefined for bytes that are not a JPEG", () => {
    expect(readExifDate(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeUndefined();
    expect(readExifDate(new Uint8Array())).toBeUndefined();
    expect(readExifDate(new Uint8Array([0xff]))).toBeUndefined();
  });

  it("returns undefined rather than throwing when the buffer stops mid-structure", () => {
    // The normal case for a partial read: the caller only streamed the file's head, so
    // every truncation length has to be survivable.
    const jpeg = buildJpegWithExif({ dateTimeOriginal: "2019:06:09 14:35:01" });
    for (let length = 0; length < jpeg.length; length += 1) {
      expect(() => readExifDate(jpeg.subarray(0, length))).not.toThrow();
    }
  });

  it("does not mistake the string Exif in image data for a real segment", () => {
    // Walking the marker chain rather than searching for the identifier is what
    // prevents this: compressed pixel data can contain those bytes by coincidence.
    const withoutExif = [...buildJpegWithExif({ withoutExif: true })];
    const identifier = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
    // Splice the identifier into the scan data, past the SOS marker.
    const jpeg = new Uint8Array([...withoutExif, ...identifier, 0x49, 0x49, 0x2a, 0x00]);
    expect(readExifDate(jpeg)).toBeUndefined();
  });
});

describe("parseExifDate", () => {
  it("accepts the spec's colon form and the dashed form real files also use", () => {
    expect(parseExifDate("2019:06:09 14:35:01")).toBe("2019-06-09");
    expect(parseExifDate("2019-06-09 14:35:01")).toBe("2019-06-09");
  });

  it("tolerates surrounding whitespace and a date with no time", () => {
    expect(parseExifDate("  2019:06:09 14:35:01  ")).toBe("2019-06-09");
    expect(parseExifDate("2019:06:09")).toBe("2019-06-09");
  });

  it("rejects the zeroed timestamp that means unset", () => {
    // Cameras and editing tools both write this; returning it as a date would file
    // photos under a nonexistent day.
    expect(parseExifDate("0000:00:00 00:00:00")).toBeUndefined();
    expect(parseExifDate("2019:00:00 00:00:00")).toBeUndefined();
  });

  it("rejects an impossible calendar date", () => {
    expect(parseExifDate("2019:02:30 12:00:00")).toBeUndefined();
    expect(parseExifDate("2019:13:01 12:00:00")).toBeUndefined();
  });

  it("rejects malformed and missing values", () => {
    expect(parseExifDate(undefined)).toBeUndefined();
    expect(parseExifDate("")).toBeUndefined();
    expect(parseExifDate("not a date")).toBeUndefined();
    expect(parseExifDate("19:06:09")).toBeUndefined();
  });
});
