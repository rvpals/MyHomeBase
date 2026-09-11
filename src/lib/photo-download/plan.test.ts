import { describe, expect, it } from "vitest";
import { MAX_DOWNLOAD_PHOTOS, photoArchiveName, planPhotoDownload } from "./index";

const JUNE = "2019/2019-06 June/IMG_20190609_143501.jpg";
const JULY = "2021/2021-07-04 Fireworks/IMG_0002.jpg";

describe("planPhotoDownload", () => {
  it("keeps the bare file name when there is no collision", () => {
    // The common case, and the one worth reading well: a handful of photos from one
    // day out should extract as the names they already have.
    const plan = planPhotoDownload([JUNE, JULY]);

    expect(plan).toEqual([
      { relativePath: JUNE, entryName: "IMG_20190609_143501.jpg" },
      { relativePath: JULY, entryName: "IMG_0002.jpg" },
    ]);
  });

  it("disambiguates two photos that share a file name", () => {
    // The reason the archive can't just use file names: a flat zip of `IMG_0001.jpg`
    // from two different days would silently keep one of them.
    const plan = planPhotoDownload([
      "2019/2019-06 June/IMG_0001.jpg",
      "2021/2021-07-04 Fireworks/IMG_0001.jpg",
    ]);

    expect(plan[0]!.entryName).toBe("IMG_0001.jpg");
    // The folder keeps its hyphens: `sanitiseNameSegment` strips only what Windows and
    // macOS actually refuse (`<>:"/\|?*` and control characters). A date is the most
    // common folder name in this archive, and `2021 07 04` is not the name anyone would
    // recognise.
    expect(plan[1]!.entryName).toBe("2021 - 2021-07-04 Fireworks - IMG_0001.jpg");
    // Whatever the names, they must differ — that is the contract `buildZip` relies on.
    expect(new Set(plan.map((entry) => entry.entryName)).size).toBe(2);
  });

  it("still produces unique names when the folder labels collide too", () => {
    // Two folders that sanitise to one label (a colon becomes a space, so `10:30` and
    // `10 30` converge). The counter is the backstop.
    const plan = planPhotoDownload([
      "2019/10:30 Party/IMG_0001.jpg",
      "2019/10 30 Party/IMG_0001.jpg",
      "2019/10-30 Party/IMG_0001.jpg",
    ]);

    expect(new Set(plan.map((entry) => entry.entryName)).size).toBe(3);
  });

  it("strips characters an extractor would refuse in a file name", () => {
    // Legal on the NAS, illegal on the Windows machine unpacking it — and an extractor
    // tends to fail the whole archive over one bad name rather than skip the entry.
    const plan = planPhotoDownload([
      "2019/A day out/IMG_0001.jpg",
      "2019/B day out/IMG_0001.jpg",
    ]);

    for (const entry of plan) {
      expect(entry.entryName).not.toMatch(/[<>:"/\\|?*]/);
    }
  });

  it("normalises paths and collapses an exact duplicate", () => {
    const plan = planPhotoDownload([JUNE, JUNE.split("/").join("\\")]);

    expect(plan).toHaveLength(1);
    expect(plan[0]!.relativePath).toBe(JUNE);
  });

  it("refuses an empty selection", () => {
    expect(() => planPhotoDownload([])).toThrow(/at least one/);
  });

  it("refuses a selection past the ceiling, naming the limit", () => {
    // A "select all" over a list that has grown big should get a clear answer, not a
    // request that grinds for minutes and then fails.
    const many = Array.from(
      { length: MAX_DOWNLOAD_PHOTOS + 1 },
      (_unused, index) => `2019/2019-06 June/IMG_${index}.jpg`,
    );

    expect(() => planPhotoDownload(many)).toThrow(String(MAX_DOWNLOAD_PHOTOS));
  });

  it("rejects a path that tries to escape the photo root", () => {
    // These arrive from a browser, so a crafted one must not become a file read.
    expect(() => planPhotoDownload(["../../etc/passwd"])).toThrow();
    expect(() => planPhotoDownload([JUNE, "/etc/passwd"])).toThrow();
  });
});

describe("photoArchiveName", () => {
  it("dates the archive so repeat downloads don't collide", () => {
    expect(photoArchiveName("favorite-photos", new Date(2026, 8, 1))).toBe(
      "favorite-photos-2026-09-01.zip",
    );
  });

  it("pads single-digit months and days", () => {
    expect(photoArchiveName("favorite-photos", new Date(2026, 0, 5))).toBe(
      "favorite-photos-2026-01-05.zip",
    );
  });

  it("strips a path separator out of an album's name", () => {
    // The label is the reader's own text for an album, so it reaches a
    // Content-Disposition header. A slash there either mangles the download or
    // escapes the Downloads folder.
    expect(photoArchiveName("Summer 2019 / Croatia", new Date(2026, 8, 1))).toBe(
      "Summer-2019-Croatia-2026-09-01.zip",
    );
  });

  it("strips a colon, which is legal on the NAS and not on the desktop", () => {
    expect(photoArchiveName("10:30 Fireworks", new Date(2026, 8, 1))).toBe(
      "10-30-Fireworks-2026-09-01.zip",
    );
  });

  it("falls back to a stem when the label sanitises away to nothing", () => {
    // Unusual but legal. Without the fallback this is "-2026-09-01.zip", which reads
    // as a bug rather than as a download.
    expect(photoArchiveName("***", new Date(2026, 8, 1))).toBe("photos-2026-09-01.zip");
  });

  it("clamps a very long album name", () => {
    const name = photoArchiveName("A".repeat(200), new Date(2026, 8, 1));
    expect(name.endsWith("-2026-09-01.zip")).toBe(true);
    // 60 characters of stem, plus the dated suffix — short enough for any filesystem.
    expect(name.length).toBeLessThanOrEqual(80);
  });
});
