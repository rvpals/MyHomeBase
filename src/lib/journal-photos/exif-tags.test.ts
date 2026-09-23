import { describe, expect, it } from "vitest";

import { describeExifTag, formatExifValue, hexName } from "./exif-tags";

describe("describeExifTag", () => {
  describe("naming and grouping", () => {
    it("names a known camera tag and puts it on the common tab", () => {
      const spec = describeExifTag(0x010f, "ifd0");

      expect(spec.name).toBe("Camera make");
      expect(spec.group).toBe("common");
    });

    it("puts a known but uninteresting tag on the misc tab", () => {
      expect(describeExifTag(0x011a, "ifd0").group).toBe("misc");
    });

    it("names an unknown tag by its hex id, on misc", () => {
      const spec = describeExifTag(0xfe12, "exif");

      expect(spec.name).toBe("Tag 0xfe12");
      expect(spec.group).toBe("misc");
    });

    it("puts a GPS tag read from the GPS IFD on the gps tab", () => {
      const spec = describeExifTag(0x0002, "gps");

      expect(spec.name).toBe("Latitude");
      expect(spec.group).toBe("gps");
    });
  });

  describe("the low-id collision between the GPS IFD and IFD0", () => {
    // 0x0002 means Latitude in the GPS IFD and Image height in IFD0. Resolving by id
    // alone would label one as the other.
    it("does not name an IFD0 tag with its GPS meaning", () => {
      const spec = describeExifTag(0x0002, "ifd0");

      expect(spec.name).not.toBe("Latitude");
      expect(spec.group).toBe("misc");
    });

    it("does not name a GPS tag with its IFD0 meaning", () => {
      const spec = describeExifTag(0x0101, "gps");

      expect(spec.name).toBe("Tag 0x0101");
      expect(spec.group).toBe("gps");
    });

    it("keeps every tag read from the GPS IFD on the gps tab", () => {
      for (const id of [0x0000, 0x0007, 0x001d, 0xbeef]) {
        expect(describeExifTag(id, "gps").group).toBe("gps");
      }
    });
  });
});

describe("formatExifValue", () => {
  it("uses the tag's formatter when it has one", () => {
    const spec = describeExifTag(0x8827, "exif");

    expect(formatExifValue(800, spec.format)).toBe("ISO 800");
  });

  it("shows a plain string unchanged when there is no formatter", () => {
    expect(formatExifValue("Canon EOS 5D")).toBe("Canon EOS 5D");
  });

  it("trims a trailing zero from a decimal", () => {
    expect(formatExifValue(50)).toBe("50");
    expect(formatExifValue(2.8)).toBe("2.8");
  });

  it("joins a multi-component value with commas", () => {
    expect(formatExifValue([1, 2, 3])).toBe("1, 2, 3");
  });

  it("formats an exposure bias with its sign and unit", () => {
    const spec = describeExifTag(0x9204, "exif");

    expect(formatExifValue(0.5, spec.format)).toBe("+0.5 EV");
    expect(formatExifValue(-1, spec.format)).toBe("-1 EV");
    expect(formatExifValue(0, spec.format)).toBe("0 EV");
  });

  it("reports an unrecognised coded value rather than showing a bare number", () => {
    const spec = describeExifTag(0x0112, "ifd0");

    expect(formatExifValue(99, spec.format)).toBe("Unknown (99)");
  });

  it("falls back to the raw text when a formatter cannot read the value", () => {
    const spec = describeExifTag(0x829a, "exif");

    expect(formatExifValue("not a number", spec.format)).toBe("not a number");
  });
});

describe("hexName", () => {
  it("pads a short tag id to four digits, so the column aligns", () => {
    expect(hexName(0x0a)).toBe("Tag 0x000a");
    expect(hexName(0xa430)).toBe("Tag 0xa430");
  });
});
