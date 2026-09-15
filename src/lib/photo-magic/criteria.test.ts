import { describe, expect, it } from "vitest";
import { describeCriteria, matchesCriteria, matchesDateRange } from "./criteria";
import type { IndexedPhoto, PhotoMagicCriteria } from "./types";
import { emptyCriteria } from "./types";

// `matchesCriteria` is the single definition of what a Magic List MEANS, so the
// absent-bound rule gets the most attention here: an omitted bound must widen the
// search, never empty it. Getting that backwards produces a list that is silently empty
// for a reason no error message would ever explain.

function photo(overrides: Partial<IndexedPhoto> = {}): IndexedPhoto {
  return {
    relativePath: "2019/2019-06-09 Farm/IMG_0001.jpg",
    bytes: 4 * 1024 * 1024,
    width: 1920,
    height: 1080,
    takenAtDate: "2019-06-09",
    takenAtSource: "exif",
    ...overrides,
  };
}

function criteria(overrides: Partial<PhotoMagicCriteria> = {}): PhotoMagicCriteria {
  return { ...emptyCriteria(), ...overrides };
}

describe("matchesCriteria — the absent-bound rule", () => {
  it("matches everything when nothing is restricted", () => {
    expect(matchesCriteria(photo(), criteria())).toBe(true);
  });

  it("does not exclude a photo because a bound was left blank", () => {
    // The rule this whole function exists to get right. A tiny, low-resolution,
    // undated photograph still matches criteria that restrict nothing -- if an absent
    // bound behaved like a zero or an infinity, this would fail.
    const tiny = photo({
      bytes: 1,
      width: undefined,
      height: undefined,
      takenAtDate: undefined,
      takenAtSource: "none",
    });
    expect(matchesCriteria(tiny, criteria())).toBe(true);
  });

  it("applies only the end of a range that was given", () => {
    const subject = photo({ takenAtDate: "2019-06-09" });
    expect(matchesCriteria(subject, criteria({ fromDate: "2019-01-01" }))).toBe(true);
    expect(matchesCriteria(subject, criteria({ toDate: "2019-12-31" }))).toBe(true);
    expect(matchesCriteria(subject, criteria({ fromDate: "2020-01-01" }))).toBe(false);
    expect(matchesCriteria(subject, criteria({ toDate: "2018-12-31" }))).toBe(false);
  });
});

describe("matchesCriteria — dates", () => {
  it("includes both ends of the range", () => {
    // Inclusive: a reader asking for June 1st to June 9th means both days.
    const range = criteria({ fromDate: "2019-06-01", toDate: "2019-06-09" });
    expect(matchesCriteria(photo({ takenAtDate: "2019-06-01" }), range)).toBe(true);
    expect(matchesCriteria(photo({ takenAtDate: "2019-06-09" }), range)).toBe(true);
    expect(matchesCriteria(photo({ takenAtDate: "2019-05-31" }), range)).toBe(false);
    expect(matchesCriteria(photo({ takenAtDate: "2019-06-10" }), range)).toBe(false);
  });

  it("excludes a photo with no established date when a range is set", () => {
    // A date criterion is a positive claim about when the picture was taken, and "we
    // don't know" does not support it.
    const undated = photo({ takenAtDate: undefined, takenAtSource: "none" });
    expect(matchesCriteria(undated, criteria({ fromDate: "2019-01-01" }))).toBe(false);
  });

  it("compares dates as strings across a year boundary", () => {
    // `YYYY-MM-DD` sorts chronologically, which is why no Date parsing is needed. A
    // naive numeric or locale comparison is what gets this wrong.
    const range = criteria({ fromDate: "2019-12-30", toDate: "2020-01-02" });
    expect(matchesCriteria(photo({ takenAtDate: "2019-12-31" }), range)).toBe(true);
    expect(matchesCriteria(photo({ takenAtDate: "2020-01-01" }), range)).toBe(true);
    expect(matchesCriteria(photo({ takenAtDate: "2020-01-03" }), range)).toBe(false);
  });

  it("accepts a date established from a file name or folder, not just EXIF", () => {
    // The source is recorded for honesty, but it does not change eligibility -- a
    // photograph dated from its folder is still in the range its folder names.
    const inferred = photo({ takenAtDate: "2019-06-09", takenAtSource: "folder" });
    expect(matchesCriteria(inferred, criteria({ fromDate: "2019-06-01" }))).toBe(true);
  });
});

describe("matchesCriteria — file size", () => {
  it("includes both ends of the band", () => {
    const band = criteria({ minBytes: 1000, maxBytes: 2000 });
    expect(matchesCriteria(photo({ bytes: 1000 }), band)).toBe(true);
    expect(matchesCriteria(photo({ bytes: 2000 }), band)).toBe(true);
    expect(matchesCriteria(photo({ bytes: 999 }), band)).toBe(false);
    expect(matchesCriteria(photo({ bytes: 2001 }), band)).toBe(false);
  });

  it("treats a zero minimum as a real bound, not as absent", () => {
    // `0` and `undefined` must not be conflated -- every photo passes either way here,
    // but the distinction is what keeps `minBytes: 0` from being dropped upstream.
    expect(matchesCriteria(photo({ bytes: 0 }), criteria({ minBytes: 0 }))).toBe(true);
  });
});

describe("matchesCriteria — resolution", () => {
  it("applies a width and height floor together", () => {
    const hd = criteria({ minWidth: 1920, minHeight: 1080 });
    expect(matchesCriteria(photo({ width: 1920, height: 1080 }), hd)).toBe(true);
    expect(matchesCriteria(photo({ width: 4032, height: 3024 }), hd)).toBe(true);
    // Wide enough but not tall enough -- the case a megapixel count would wave through.
    expect(matchesCriteria(photo({ width: 3000, height: 700 }), hd)).toBe(false);
  });

  it("excludes a photo whose dimensions could not be read", () => {
    // The deliberate call: unknown is NOT treated as passing. Admitting it would put
    // photographs of unknown size into a list whose whole purpose was "only the big
    // ones", which the reader would notice and could not explain.
    const unknown = photo({ width: undefined, height: undefined });
    expect(matchesCriteria(unknown, criteria({ minWidth: 1920 }))).toBe(false);
    expect(matchesCriteria(unknown, criteria({ maxHeight: 4000 }))).toBe(false);
  });

  it("admits a photo with unknown dimensions when no resolution bound is set", () => {
    // The other half of the rule: unknown dimensions only exclude when the reader
    // actually asked about resolution.
    const unknown = photo({ width: undefined, height: undefined });
    expect(matchesCriteria(unknown, criteria({ minBytes: 1 }))).toBe(true);
  });

  it("applies a maximum as well as a minimum", () => {
    const band = criteria({ maxWidth: 2000, maxHeight: 2000 });
    expect(matchesCriteria(photo({ width: 1920, height: 1080 }), band)).toBe(true);
    expect(matchesCriteria(photo({ width: 4032, height: 3024 }), band)).toBe(false);
  });
});

describe("matchesCriteria — combining", () => {
  it("requires every criterion at once", () => {
    // ANDed, not ORed. A photograph satisfying three of four bounds is out.
    const strict = criteria({
      fromDate: "2019-01-01",
      toDate: "2019-12-31",
      minBytes: 2 * 1024 * 1024,
      minWidth: 1920,
      minHeight: 1080,
    });
    expect(matchesCriteria(photo(), strict)).toBe(true);
    expect(matchesCriteria(photo({ takenAtDate: "2020-03-01" }), strict)).toBe(false);
    expect(matchesCriteria(photo({ bytes: 1024 }), strict)).toBe(false);
    expect(matchesCriteria(photo({ width: 800, height: 600 }), strict)).toBe(false);
  });

  it("ignores maxPhotos, which caps the draw rather than eligibility", () => {
    // A photograph is not made ineligible by how many others there are.
    expect(matchesCriteria(photo(), criteria({ maxPhotos: 1 }))).toBe(true);
  });
});

describe("matchesDateRange", () => {
  it("ignores size and resolution bounds", () => {
    // What `countUnknownSizeInRange` needs: asking "is it in the period" with the
    // resolution bound still applied would answer zero by construction.
    const subject = photo({ width: undefined, height: undefined, bytes: 1 });
    const strict = criteria({
      fromDate: "2019-01-01",
      toDate: "2019-12-31",
      minWidth: 1920,
      minBytes: 999_999_999,
    });
    expect(matchesDateRange(subject, strict)).toBe(true);
    expect(matchesCriteria(subject, strict)).toBe(false);
  });

  it("is true for everything when no range is set", () => {
    expect(matchesDateRange(photo({ takenAtDate: undefined }), criteria())).toBe(true);
  });

  it("excludes an undated photo when a range is set", () => {
    const undated = photo({ takenAtDate: undefined });
    expect(matchesDateRange(undated, criteria({ fromDate: "2019-01-01" }))).toBe(false);
  });
});

describe("describeCriteria", () => {
  it("says so when nothing is restricted", () => {
    expect(describeCriteria(criteria({ maxPhotos: 50 }))).toBe("Any photograph — up to 50.");
  });

  it("renders a full date range", () => {
    const text = describeCriteria(criteria({ fromDate: "2019-01-01", toDate: "2019-12-31" }));
    expect(text).toContain("taken between 2019-01-01 and 2019-12-31");
  });

  it("renders a one-ended date range", () => {
    expect(describeCriteria(criteria({ fromDate: "2019-01-01" }))).toContain(
      "taken on or after 2019-01-01",
    );
    expect(describeCriteria(criteria({ toDate: "2019-12-31" }))).toContain(
      "taken on or before 2019-12-31",
    );
  });

  it("renders sizes in megabytes", () => {
    expect(describeCriteria(criteria({ minBytes: 4 * 1024 * 1024 }))).toContain(
      "at least 4.0 MB",
    );
  });

  it("pairs width and height into one resolution clause", () => {
    // "at least 1920 × 1080", not two separate conditions -- that is how a reader
    // thinks of a resolution.
    const text = describeCriteria(criteria({ minWidth: 1920, minHeight: 1080 }));
    expect(text).toContain("at least 1920 × 1080");
    expect(text).not.toContain("px wide");
  });

  it("falls back to a single dimension when only one is bounded", () => {
    expect(describeCriteria(criteria({ minWidth: 1920 }))).toContain("at least 1920 px wide");
  });

  it("always states the ceiling", () => {
    expect(describeCriteria(criteria({ maxPhotos: 250 }))).toContain("up to 250");
  });
});
