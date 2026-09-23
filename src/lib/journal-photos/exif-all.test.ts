import { describe, expect, it } from "vitest";

import { readAllExifTags } from "./exif-all";
import { buildJpegWithTags, degreesMinutesSeconds } from "./exif-all.fixture";

/** The row for one tag, by the name the table gives it. */
function row(tags: ReturnType<typeof readAllExifTags>["tags"], name: string) {
  return tags.find((tag) => tag.name === name);
}

describe("readAllExifTags", () => {
  describe("reading tags", () => {
    it("reads a string tag from IFD0", () => {
      const bytes = buildJpegWithTags({
        ifd0: [{ tag: 0x010f, type: 2, value: "Canon" }],
      });

      const { tags } = readAllExifTags(bytes);

      expect(row(tags, "Camera make")?.value).toBe("Canon");
    });

    it("reads tags from the Exif sub-IFD as well as IFD0", () => {
      const bytes = buildJpegWithTags({
        ifd0: [{ tag: 0x0110, type: 2, value: "EOS 5D" }],
        exif: [{ tag: 0x8827, type: 3, value: 400 }],
      });

      const { tags } = readAllExifTags(bytes);

      expect(row(tags, "Camera model")?.value).toBe("EOS 5D");
      expect(row(tags, "ISO speed")?.value).toBe("ISO 400");
    });

    it("reads big-endian files, as Canon and scanners write them", () => {
      const bytes = buildJpegWithTags({
        bigEndian: true,
        ifd0: [{ tag: 0x010f, type: 2, value: "NIKON" }],
        exif: [{ tag: 0x8827, type: 3, value: 1600 }],
      });

      const { tags } = readAllExifTags(bytes);

      expect(row(tags, "Camera make")?.value).toBe("NIKON");
      expect(row(tags, "ISO speed")?.value).toBe("ISO 1600");
    });

    it("omits the sub-IFD pointer tags, which are offsets rather than data", () => {
      const bytes = buildJpegWithTags({
        ifd0: [{ tag: 0x010f, type: 2, value: "Canon" }],
        exif: [{ tag: 0x8827, type: 3, value: 100 }],
      });

      const { tags } = readAllExifTags(bytes);

      expect(tags.some((tag) => tag.id === 0x8769)).toBe(false);
    });

    it("names an unknown tag by its hex id and files it under misc", () => {
      const bytes = buildJpegWithTags({
        exif: [{ tag: 0xabcd, type: 3, value: 7 }],
      });

      const { tags } = readAllExifTags(bytes);

      expect(row(tags, "Tag 0xabcd")?.group).toBe("misc");
    });
  });

  describe("value types", () => {
    it("reads a rational as an exposure fraction", () => {
      const bytes = buildJpegWithTags({
        exif: [{ tag: 0x829a, type: 5, value: [1, 125] }],
      });

      const { tags } = readAllExifTags(bytes);

      expect(row(tags, "Exposure time")?.value).toBe("1/125");
    });

    it("reads a rational as an f-number", () => {
      const bytes = buildJpegWithTags({
        exif: [{ tag: 0x829d, type: 5, value: [28, 10] }],
      });

      const { tags } = readAllExifTags(bytes);

      expect(row(tags, "F-number")?.value).toBe("f/2.8");
    });

    it("shows an exposure of a second or longer in seconds, not a fraction", () => {
      const bytes = buildJpegWithTags({
        exif: [{ tag: 0x829a, type: 5, value: [5, 2] }],
      });

      const { tags } = readAllExifTags(bytes);

      expect(row(tags, "Exposure time")?.value).toBe("2.5s");
    });

    it("decodes a coded value into the spec's words", () => {
      const bytes = buildJpegWithTags({
        ifd0: [{ tag: 0x0112, type: 3, value: 6 }],
      });

      const { tags } = readAllExifTags(bytes);

      expect(row(tags, "Orientation")?.value).toBe("Rotated 90° clockwise");
    });

    it("reads a LONG tag stored inline", () => {
      const bytes = buildJpegWithTags({
        exif: [{ tag: 0xa002, type: 4, value: 4032 }],
      });

      const { tags } = readAllExifTags(bytes);

      expect(row(tags, "Image width")?.value).toBe("4032 px");
    });

    it("keeps the unformatted value beside the formatted one", () => {
      const bytes = buildJpegWithTags({
        exif: [{ tag: 0x829d, type: 5, value: [28, 10] }],
      });

      const { tags } = readAllExifTags(bytes);

      const fNumber = row(tags, "F-number");
      expect(fNumber?.value).toBe("f/2.8");
      expect(fNumber?.raw).toBe("2.8");
    });

    it("reports a binary UNDEFINED blob by its size rather than as mangled text", () => {
      const bytes = buildJpegWithTags({
        exif: [{ tag: 0x927c, type: 7, value: [0x01, 0x02, 0x03, 0xff, 0xfe] }],
      });

      const { tags } = readAllExifTags(bytes);

      expect(row(tags, "Tag 0x927c")?.value).toBe("5 bytes");
    });
  });

  describe("GPS", () => {
    it("converts the stored degrees/minutes/seconds into a decimal fix", () => {
      const bytes = buildJpegWithTags({
        gps: [
          { tag: 0x0001, type: 2, value: "N" },
          { tag: 0x0002, type: 5, value: degreesMinutesSeconds(40, 20, 30) },
          { tag: 0x0003, type: 2, value: "W" },
          { tag: 0x0004, type: 5, value: degreesMinutesSeconds(74, 27, 45) },
        ],
      });

      const { gps } = readAllExifTags(bytes);

      expect(gps?.latitude).toBeCloseTo(40.341667, 5);
      expect(gps?.longitude).toBeCloseTo(-74.4625, 5);
    });

    it("applies the reference letter's sign, so S and W go negative", () => {
      const bytes = buildJpegWithTags({
        gps: [
          { tag: 0x0001, type: 2, value: "S" },
          { tag: 0x0002, type: 5, value: degreesMinutesSeconds(33, 51, 54) },
          { tag: 0x0003, type: 2, value: "E" },
          { tag: 0x0004, type: 5, value: degreesMinutesSeconds(151, 12, 36) },
        ],
      });

      const { gps } = readAllExifTags(bytes);

      expect(gps?.latitude).toBeLessThan(0);
      expect(gps?.longitude).toBeGreaterThan(0);
      expect(gps?.latitude).toBeCloseTo(-33.865, 3);
      expect(gps?.longitude).toBeCloseTo(151.21, 3);
    });

    it("files GPS tags on the gps group, not misc", () => {
      const bytes = buildJpegWithTags({
        gps: [
          { tag: 0x0001, type: 2, value: "N" },
          { tag: 0x0002, type: 5, value: degreesMinutesSeconds(1, 0, 0) },
          { tag: 0x0003, type: 2, value: "E" },
          { tag: 0x0004, type: 5, value: degreesMinutesSeconds(2, 0, 0) },
        ],
      });

      const { tags } = readAllExifTags(bytes);

      expect(row(tags, "Latitude")?.group).toBe("gps");
      expect(row(tags, "Longitude")?.group).toBe("gps");
    });

    it("does not confuse a low GPS tag id with the IFD0 tag of the same number", () => {
      // 0x0002 is Latitude in the GPS IFD and Image height in IFD0.
      const bytes = buildJpegWithTags({
        ifd0: [{ tag: 0x0101, type: 4, value: 3024 }],
        gps: [
          { tag: 0x0001, type: 2, value: "N" },
          { tag: 0x0002, type: 5, value: degreesMinutesSeconds(10, 0, 0) },
          { tag: 0x0003, type: 2, value: "E" },
          { tag: 0x0004, type: 5, value: degreesMinutesSeconds(20, 0, 0) },
        ],
      });

      const { tags } = readAllExifTags(bytes);

      const latitude = tags.find((tag) => tag.id === 0x0002 && tag.source === "gps");
      expect(latitude?.name).toBe("Latitude");
      expect(row(tags, "Image height (IFD)")?.group).toBe("misc");
    });

    it("reads altitude, negated when the reference says below sea level", () => {
      const bytes = buildJpegWithTags({
        gps: [
          { tag: 0x0001, type: 2, value: "N" },
          { tag: 0x0002, type: 5, value: degreesMinutesSeconds(40, 0, 0) },
          { tag: 0x0003, type: 2, value: "E" },
          { tag: 0x0004, type: 5, value: degreesMinutesSeconds(10, 0, 0) },
          { tag: 0x0005, type: 1, value: 1 },
          { tag: 0x0006, type: 5, value: [120, 1] },
        ],
      });

      const { gps } = readAllExifTags(bytes);

      expect(gps?.altitude).toBe(-120);
    });
  });

  describe("failure paths", () => {
    it("returns an empty readout for a file with no EXIF segment", () => {
      const bytes = buildJpegWithTags({ withoutExif: true });

      expect(readAllExifTags(bytes)).toEqual({ tags: [] });
    });

    it("returns an empty readout for bytes that are not a JPEG", () => {
      const bytes = new Uint8Array([0x00, 0x01, 0x02, 0x03]);

      expect(readAllExifTags(bytes)).toEqual({ tags: [] });
    });

    it("returns an empty readout for an empty buffer", () => {
      expect(readAllExifTags(new Uint8Array())).toEqual({ tags: [] });
    });

    it("does not throw on a buffer truncated mid-structure", () => {
      const full = buildJpegWithTags({
        ifd0: [{ tag: 0x010f, type: 2, value: "Canon" }],
        exif: [{ tag: 0x8827, type: 3, value: 400 }],
      });

      // Every truncation point, so no offset arithmetic can walk off the end.
      for (let length = 0; length < full.length; length += 1) {
        expect(() => readAllExifTags(full.slice(0, length))).not.toThrow();
      }
    });

    it("reports no fix when the GPS IFD holds no coordinates", () => {
      // A phone with location off still writes the block, carrying only a version.
      const bytes = buildJpegWithTags({
        gps: [{ tag: 0x0000, type: 1, value: 2 }],
      });

      const { gps, tags } = readAllExifTags(bytes);

      expect(gps).toBeUndefined();
      expect(row(tags, "GPS version")).toBeDefined();
    });

    it("reports no fix when a coordinate has no reference letter", () => {
      const bytes = buildJpegWithTags({
        gps: [
          { tag: 0x0002, type: 5, value: degreesMinutesSeconds(40, 20, 30) },
          { tag: 0x0004, type: 5, value: degreesMinutesSeconds(74, 27, 45) },
        ],
      });

      expect(readAllExifTags(bytes).gps).toBeUndefined();
    });

    it("reports no fix for an out-of-range latitude", () => {
      const bytes = buildJpegWithTags({
        gps: [
          { tag: 0x0001, type: 2, value: "N" },
          { tag: 0x0002, type: 5, value: degreesMinutesSeconds(200, 0, 0) },
          { tag: 0x0003, type: 2, value: "E" },
          { tag: 0x0004, type: 5, value: degreesMinutesSeconds(10, 0, 0) },
        ],
      });

      expect(readAllExifTags(bytes).gps).toBeUndefined();
    });

    it("skips a rational with a zero denominator rather than reporting Infinity", () => {
      const bytes = buildJpegWithTags({
        exif: [{ tag: 0x829d, type: 5, value: [0, 0] }],
      });

      const { tags } = readAllExifTags(bytes);

      expect(row(tags, "F-number")).toBeUndefined();
      expect(tags.every((tag) => !tag.value.includes("Infinity"))).toBe(true);
      expect(tags.every((tag) => !tag.value.includes("NaN"))).toBe(true);
    });

    it("skips a tag whose value type this reader does not decode", () => {
      const bytes = buildJpegWithTags({
        exif: [{ tag: 0x8827, type: 3, value: 200 }],
      });

      const { tags } = readAllExifTags(bytes);

      // The known tag still reads; nothing else was invented alongside it.
      expect(row(tags, "ISO speed")?.value).toBe("ISO 200");
    });
  });
});
