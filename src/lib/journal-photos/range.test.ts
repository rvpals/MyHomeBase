import { describe, expect, it } from "vitest";
import { buildJpegWithExif } from "./exif.fixture";
import { listPhotosInFolder } from "./photos";
import { listPhotoFoldersForRange } from "./range";
import type { PhotoFileStore } from "./ports";
import type { PhotoRootCheck } from "./types";

// The range lookup. The assertions worth having here are the ones a loop over the
// single-date use-case would have got wrong: a folder inside the range but on neither
// boundary, a range crossing a year, a month folder that only partly overlaps, and the
// read counts that prove a year folder is read once rather than once per date.

interface FakeArchive {
  files: Record<string, string[]>;
  headers?: Record<string, Uint8Array>;
  isRootAvailable?: boolean;
  rootProblem?: "not-configured" | "missing" | "no-permission" | "not-a-directory" | "unreachable";
}

class FakePhotoFileStore implements PhotoFileStore {
  /** How many EXIF header reads happened -- the cost the two-phase design defers. */
  readCount = 0;
  /** Which folders had their names listed, in order. Proves the per-year read. */
  listedFolders: string[] = [];

  constructor(private readonly archive: FakeArchive) {}

  async isRootAvailable(): Promise<boolean> {
    return (await this.checkRoot()).kind === "ok";
  }

  async checkRoot(): Promise<PhotoRootCheck> {
    return (this.archive.isRootAvailable ?? true)
      ? { kind: "ok", path: "/fake/PHOTO/BY YEAR" }
      : { kind: this.archive.rootProblem ?? "not-configured", path: "/fake/PHOTO/BY YEAR" };
  }

  async folderExists(relativeFolder: string): Promise<boolean> {
    return (
      relativeFolder in this.archive.files ||
      Object.keys(this.archive.files).some((path) => path.startsWith(`${relativeFolder}/`))
    );
  }

  async listFolderNames(relativeFolder: string): Promise<string[]> {
    this.listedFolders.push(relativeFolder);
    const prefix = `${relativeFolder}/`;
    const names = new Set<string>();
    for (const path of Object.keys(this.archive.files)) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      if (rest !== "") names.add(rest.split("/")[0]);
    }
    return [...names].sort();
  }

  async listPhotoNames(relativeFolder: string): Promise<string[]> {
    return (this.archive.files[relativeFolder] ?? [])
      .filter((name) => /\.jpe?g$/i.test(name))
      .sort();
  }

  async readHeader(relativePath: string): Promise<Uint8Array | undefined> {
    this.readCount += 1;
    return this.archive.headers?.[relativePath];
  }

  async readPhoto(): Promise<{ data: Uint8Array; mimeType: string } | undefined> {
    return undefined;
  }
}

describe("listPhotoFoldersForRange", () => {
  it("returns day folders inside the range and skips ones outside it", async () => {
    const store = new FakePhotoFileStore({
      files: {
        "2026/2026-01-04 New Year Walk": ["a.jpg"],
        "2026/2026-03-15 Museum": ["b.jpg"],
        "2026/2026-08-02 Beach": ["c.jpg"],
        // Both of these miss 2026-01-01..2026-08-02 by a single day.
        "2026/2025-12-31 Not In Range": ["d.jpg"],
        "2026/2026-08-03 Also Not": ["e.jpg"],
      },
    });

    const result = await listPhotoFoldersForRange(store, {
      from: "2026-01-01",
      to: "2026-08-02",
    });

    expect(result.isAvailable).toBe(true);
    expect(result.folders.map((folder) => folder.name)).toEqual([
      "2026-01-04 New Year Walk",
      "2026-03-15 Museum",
      "2026-08-02 Beach",
    ]);
    // The date each folder matched on, which a range caller cannot derive itself.
    expect(result.folders.map((folder) => folder.matchedDate)).toEqual([
      "2026-01-04",
      "2026-03-15",
      "2026-08-02",
    ]);
  });

  it("puts every day folder before every month folder", async () => {
    // The single-date lookup's confidence order, extended across the range: a folder
    // named for a day IS that day, a month folder merely overlaps the range.
    const store = new FakePhotoFileStore({
      files: {
        "2026/2026-01": ["m1.jpg"],
        "2026/2026-02 Lake Trip": ["m2.jpg"],
        "2026/2026-02-14 Valentine Dinner": ["d1.jpg"],
      },
    });

    const result = await listPhotoFoldersForRange(store, {
      from: "2026-01-01",
      to: "2026-02-28",
    });

    expect(result.folders.map((folder) => folder.kind)).toEqual(["day", "month", "month"]);
    expect(result.folders[1].matchedMonth).toBe("2026-01");
    expect(result.folders[2].label).toBe("Lake Trip");
  });

  it("includes a month folder that only partly overlaps the range", async () => {
    // The range ends on the 2nd of August, but 2026-08 holds the 1st and the 2nd.
    // Excluding the folder would lose them; which photos qualify is settled by the
    // scan, not by the folder name.
    const store = new FakePhotoFileStore({ files: { "2026/2026-08": ["a.jpg"] } });

    const result = await listPhotoFoldersForRange(store, {
      from: "2026-01-01",
      to: "2026-08-02",
    });

    expect(result.folders.map((folder) => folder.name)).toEqual(["2026-08"]);
  });

  it("reads each year folder in the range exactly once", async () => {
    // The reason this is not a loop over listPhotoFoldersForDate: that would re-read
    // the same year folder once per date -- hundreds of times for a range like this.
    const store = new FakePhotoFileStore({
      files: { "2026/2026-03-15 Museum": ["a.jpg"], "2027/2027-01-02 Snow": ["b.jpg"] },
    });

    await listPhotoFoldersForRange(store, { from: "2026-01-01", to: "2027-08-02" });

    expect(store.listedFolders).toEqual(["2026", "2027"]);
  });

  it("spans a year boundary, and skips a year with no folder", async () => {
    const store = new FakePhotoFileStore({
      files: {
        "2025/2025-12-30 Year End": ["a.jpg"],
        // No 2026 folder at all.
        "2027/2027-01-02 Snow": ["b.jpg"],
      },
    });

    const result = await listPhotoFoldersForRange(store, {
      from: "2025-12-01",
      to: "2027-01-31",
    });

    expect(result.isAvailable).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.folders.map((folder) => folder.name)).toEqual([
      "2025-12-30 Year End",
      "2027-01-02 Snow",
    ]);
  });

  it("reads nothing but folder names -- no photo is opened", async () => {
    const store = new FakePhotoFileStore({
      files: { "2026/2026-01": Array.from({ length: 500 }, (_, index) => `IMG_${index}.jpg`) },
    });

    await listPhotoFoldersForRange(store, { from: "2026-01-01", to: "2026-08-02" });

    // A wide range must stay instant to open; the EXIF cost is paid per folder opened,
    // not up front.
    expect(store.readCount).toBe(0);
  });

  it("drops a matching folder that holds no JPEGs", async () => {
    const store = new FakePhotoFileStore({
      files: { "2026/2026-03-15 Raw Only": ["IMG_1.cr2", "IMG_2.dng"] },
    });

    const result = await listPhotoFoldersForRange(store, {
      from: "2026-01-01",
      to: "2026-12-31",
    });

    expect(result.folders).toEqual([]);
  });

  it("treats a month-precision day-00 folder as a month folder", async () => {
    const store = new FakePhotoFileStore({
      files: { "2026/2026-01-00 San Diego Vacation": ["a.jpg"] },
    });

    const result = await listPhotoFoldersForRange(store, {
      from: "2026-01-01",
      to: "2026-08-02",
    });

    expect(result.folders[0].kind).toBe("month");
    expect(result.folders[0].matchedMonth).toBe("2026-01");
    expect(result.folders[0].label).toBe("San Diego Vacation");
  });

  it("reports no-year-folder when none of the range's years are filed", async () => {
    const store = new FakePhotoFileStore({ files: { "2019/2019-06": ["a.jpg"] } });

    const result = await listPhotoFoldersForRange(store, {
      from: "2026-01-01",
      to: "2026-08-02",
    });

    // An ordinary empty result, not a failure: the archive simply has nothing filed
    // for those years.
    expect(result.isAvailable).toBe(true);
    expect(result.reason).toBe("no-year-folder");
    expect(result.folders).toEqual([]);
  });

  it("returns nothing for an inverted range rather than throwing", async () => {
    const store = new FakePhotoFileStore({ files: { "2026/2026-03-15 Museum": ["a.jpg"] } });

    const result = await listPhotoFoldersForRange(store, {
      from: "2026-08-02",
      to: "2026-01-01",
    });

    expect(result.folders).toEqual([]);
    // Not even a directory read: the year list is empty, so nothing is touched.
    expect(store.listedFolders).toEqual([]);
  });

  it("carries the root problem through rather than reporting an empty archive", async () => {
    const store = new FakePhotoFileStore({
      files: {},
      isRootAvailable: false,
      rootProblem: "no-permission",
    });

    const result = await listPhotoFoldersForRange(store, {
      from: "2026-01-01",
      to: "2026-08-02",
    });

    expect(result.isAvailable).toBe(false);
    expect(result.reason).toBe("no-permission");
    expect(result.rootPath).toBe("/fake/PHOTO/BY YEAR");
  });
});

describe("listPhotosInFolder over a range", () => {
  const MONTH = "2026/2026-08";

  it("keeps the photos whose EXIF date falls inside the range", async () => {
    const store = new FakePhotoFileStore({
      files: { [MONTH]: ["IMG_1.jpg", "IMG_2.jpg", "IMG_3.jpg"] },
      headers: {
        [`${MONTH}/IMG_1.jpg`]: buildJpegWithExif({ dateTimeOriginal: "2026:08:01 09:00:00" }),
        [`${MONTH}/IMG_2.jpg`]: buildJpegWithExif({ dateTimeOriginal: "2026:08:02 18:30:00" }),
        // The day after the range ends.
        [`${MONTH}/IMG_3.jpg`]: buildJpegWithExif({ dateTimeOriginal: "2026:08:03 07:00:00" }),
      },
    });

    const result = await listPhotosInFolder(store, {
      from: "2026-01-01",
      to: "2026-08-02",
      relativePath: MONTH,
    });

    expect(result.photos.map((photo) => photo.name)).toEqual(["IMG_1.jpg", "IMG_2.jpg"]);
    expect(result.examined).toBe(3);
    expect(result.isEmptyAfterFilter).toBe(false);
  });

  it("falls back to a date in the file name when EXIF is missing", async () => {
    const store = new FakePhotoFileStore({
      files: { [MONTH]: ["IMG_20260802_120000.jpg", "IMG_20260815_120000.jpg"] },
      headers: {
        [`${MONTH}/IMG_20260802_120000.jpg`]: buildJpegWithExif({ withoutExif: true }),
        [`${MONTH}/IMG_20260815_120000.jpg`]: buildJpegWithExif({ withoutExif: true }),
      },
    });

    const result = await listPhotosInFolder(store, {
      from: "2026-01-01",
      to: "2026-08-02",
      relativePath: MONTH,
    });

    expect(result.photos.map((photo) => photo.matchedBy)).toEqual(["file-name"]);
    expect(result.photos[0].name).toBe("IMG_20260802_120000.jpg");
  });

  it("takes every photo in a day folder inside the range without opening a file", async () => {
    const day = "2026/2026-03-15 Museum";
    const store = new FakePhotoFileStore({ files: { [day]: ["a.jpg", "b.jpg"] } });

    const result = await listPhotosInFolder(store, {
      from: "2026-01-01",
      to: "2026-08-02",
      relativePath: day,
    });

    expect(result.kind).toBe("day");
    expect(result.photos.map((photo) => photo.matchedBy)).toEqual(["folder", "folder"]);
    expect(store.readCount).toBe(0);
  });

  it("reports isEmptyAfterFilter when a month has photos but none in the range", async () => {
    const store = new FakePhotoFileStore({
      files: { [MONTH]: ["IMG_1.jpg"] },
      headers: {
        [`${MONTH}/IMG_1.jpg`]: buildJpegWithExif({ dateTimeOriginal: "2026:08:20 09:00:00" }),
      },
    });

    const result = await listPhotosInFolder(store, {
      from: "2026-08-01",
      to: "2026-08-02",
      relativePath: MONTH,
    });

    expect(result.photos).toEqual([]);
    expect(result.isEmptyAfterFilter).toBe(true);
  });

  it("includeAll overrides the range filter", async () => {
    const store = new FakePhotoFileStore({
      files: { [MONTH]: ["IMG_1.jpg", "IMG_2.jpg"] },
      headers: {
        [`${MONTH}/IMG_1.jpg`]: buildJpegWithExif({ dateTimeOriginal: "2026:08:20 09:00:00" }),
        [`${MONTH}/IMG_2.jpg`]: buildJpegWithExif({ dateTimeOriginal: "2026:08:25 09:00:00" }),
      },
    });

    const result = await listPhotosInFolder(store, {
      from: "2026-08-01",
      to: "2026-08-02",
      relativePath: MONTH,
      includeAll: true,
    });

    expect(result.photos).toHaveLength(2);
    expect(store.readCount).toBe(0);
  });

  it("matches nothing when neither a date nor a range is given", async () => {
    // A caller that skipped validation must find no photos, never every photo.
    const store = new FakePhotoFileStore({
      files: { [MONTH]: ["IMG_1.jpg"] },
      headers: {
        [`${MONTH}/IMG_1.jpg`]: buildJpegWithExif({ dateTimeOriginal: "2026:08:01 09:00:00" }),
      },
    });

    const result = await listPhotosInFolder(store, { relativePath: MONTH });

    expect(result.photos).toEqual([]);
  });
});
