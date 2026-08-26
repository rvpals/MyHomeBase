import { describe, expect, it } from "vitest";
import { buildJpegWithExif } from "./exif.fixture";
import { listPhotoFoldersForDate, listPhotosInFolder } from "./photos";
import type { PhotoFileStore } from "./ports";
import type { PhotoRootCheck } from "./types";

// A hand-written in-memory store rather than a mock: the interesting assertions are
// about which folders and photos come back, and a fake lets a whole archive shape be
// written down as data. It also lets `readCount` prove the expensive path is only
// taken when it should be.

interface FakeArchive {
  /** Relative folder -> the file names directly inside it. */
  files: Record<string, string[]>;
  /** Relative file path -> the bytes its header read returns. */
  headers?: Record<string, Uint8Array>;
  isRootAvailable?: boolean;
  /** Which failure `checkRoot` reports when `isRootAvailable` is false. */
  rootProblem?: "not-configured" | "missing" | "no-permission" | "not-a-directory" | "unreachable";
}

class FakePhotoFileStore implements PhotoFileStore {
  /** How many header reads happened -- the cost the two-phase design exists to avoid. */
  readCount = 0;

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

const DATE = "2019-06-09";
const EVENT_FOLDER = "2019/2019-06-09 Von Thun Farm Strawberry Festival Washington";
const MONTH_FOLDER = "2019/2019-06";

describe("listPhotoFoldersForDate", () => {
  it("returns the day folder and the month folder, day first", () => {
    // Confidence order: a folder named for the date IS the date; the month folder
    // merely might hold something from it.
    const store = new FakePhotoFileStore({
      files: {
        [EVENT_FOLDER]: ["IMG_1.jpg", "IMG_2.jpg"],
        [MONTH_FOLDER]: ["IMG_9.jpg"],
      },
    });

    return listPhotoFoldersForDate(store, DATE).then((result) => {
      expect(result.isAvailable).toBe(true);
      expect(result.folders.map((folder) => folder.kind)).toEqual(["day", "month"]);
      expect(result.folders[0].name).toBe("2019-06-09 Von Thun Farm Strawberry Festival Washington");
      expect(result.folders[0].label).toBe("Von Thun Farm Strawberry Festival Washington");
      expect(result.folders[0].photoCount).toBe(2);
      expect(result.folders[1].name).toBe("2019-06");
    });
  });

  it("returns several day folders for one date, sorted by name", () => {
    const store = new FakePhotoFileStore({
      files: {
        "2019/2019-06-09 Morning Hike": ["a.jpg"],
        "2019/2019-06-09 Von Thun Farm": ["b.jpg"],
      },
    });

    return listPhotoFoldersForDate(store, DATE).then((result) => {
      expect(result.folders.map((folder) => folder.label)).toEqual([
        "Morning Hike",
        "Von Thun Farm",
      ]);
    });
  });

  it("ignores other dates, other months and other years", () => {
    const store = new FakePhotoFileStore({
      files: {
        [EVENT_FOLDER]: ["IMG_1.jpg"],
        "2019/2019-06-10 Next Day": ["x.jpg"],
        "2019/2019-07": ["y.jpg"],
        "2018/2018-06-09 Same Day Last Year": ["z.jpg"],
      },
    });

    return listPhotoFoldersForDate(store, DATE).then((result) => {
      expect(result.folders.map((folder) => folder.relativePath)).toEqual([
        EVENT_FOLDER,
        // No month folder for 2019-06 exists in this archive.
      ]);
    });
  });

  it("drops a matching folder that holds no JPEGs", () => {
    // A RAW-only folder: offering it would open onto an empty grid.
    const store = new FakePhotoFileStore({
      files: { "2019/2019-06-09 RAW Only": ["IMG_1.CR2", "IMG_2.NEF"] },
    });

    return listPhotoFoldersForDate(store, DATE).then((result) => {
      expect(result.folders).toEqual([]);
    });
  });

  it("reports not-configured when the root is unavailable", () => {
    const store = new FakePhotoFileStore({ files: {}, isRootAvailable: false });

    return listPhotoFoldersForDate(store, DATE).then((result) => {
      expect(result.isAvailable).toBe(false);
      expect(result.reason).toBe("not-configured");
      expect(result.folders).toEqual([]);
    });
  });

  it("passes the root's specific problem through, not a generic failure", async () => {
    // The distinction the card needs: a share the app cannot read has a different fix
    // from a path that does not exist, and collapsing them into one message is what
    // made the NAS misconfiguration hard to diagnose in the first place.
    for (const problem of ["missing", "no-permission", "not-a-directory", "unreachable"] as const) {
      const store = new FakePhotoFileStore({ files: {}, isRootAvailable: false, rootProblem: problem });
      const result = await listPhotoFoldersForDate(store, DATE);
      expect(result.isAvailable).toBe(false);
      expect(result.reason).toBe(problem);
      // The path is echoed back so the card can show what was actually tried.
      expect(result.rootPath).toBe("/fake/PHOTO/BY YEAR");
    }
  });

  it("reports no-year-folder as an ordinary empty result, not a failure", () => {
    const store = new FakePhotoFileStore({ files: { "2021/2021-01": ["a.jpg"] } });

    return listPhotoFoldersForDate(store, DATE).then((result) => {
      expect(result.isAvailable).toBe(true);
      expect(result.reason).toBe("no-year-folder");
      expect(result.folders).toEqual([]);
    });
  });

  it("opens no files at all", () => {
    // The whole reason folder lookup is a separate call from listing photos.
    const store = new FakePhotoFileStore({
      files: { [EVENT_FOLDER]: ["IMG_1.jpg"], [MONTH_FOLDER]: Array.from({ length: 300 }, (_, i) => `IMG_${i}.jpg`) },
    });

    return listPhotoFoldersForDate(store, DATE).then(() => {
      expect(store.readCount).toBe(0);
    });
  });
});

describe("listPhotosInFolder — day folder", () => {
  it("returns every photo without reading any file", () => {
    const store = new FakePhotoFileStore({
      files: { [EVENT_FOLDER]: ["IMG_1.jpg", "IMG_2.jpg", "notes.txt"] },
    });

    return listPhotosInFolder(store, { date: DATE, relativePath: EVENT_FOLDER }).then((result) => {
      expect(result.kind).toBe("day");
      expect(result.photos.map((photo) => photo.name)).toEqual(["IMG_1.jpg", "IMG_2.jpg"]);
      expect(result.photos.every((photo) => photo.matchedBy === "folder")).toBe(true);
      // The folder name is the evidence; opening the files would buy nothing.
      expect(store.readCount).toBe(0);
    });
  });
});

describe("listPhotosInFolder — month folder", () => {
  const taken = (date: string) => buildJpegWithExif({ dateTimeOriginal: `${date} 14:35:01` });

  it("keeps only the photos whose EXIF date is the entry's date", () => {
    const store = new FakePhotoFileStore({
      files: { [MONTH_FOLDER]: ["a.jpg", "b.jpg", "c.jpg"] },
      headers: {
        [`${MONTH_FOLDER}/a.jpg`]: taken("2019:06:09"),
        [`${MONTH_FOLDER}/b.jpg`]: taken("2019:06:15"),
        [`${MONTH_FOLDER}/c.jpg`]: taken("2019:06:09"),
      },
    });

    return listPhotosInFolder(store, { date: DATE, relativePath: MONTH_FOLDER }).then((result) => {
      expect(result.kind).toBe("month");
      expect(result.photos.map((photo) => photo.name)).toEqual(["a.jpg", "c.jpg"]);
      expect(result.photos[0].matchedBy).toBe("exif");
      expect(result.photos[0].takenAt).toBe(DATE);
      expect(result.examined).toBe(3);
      expect(result.isEmptyAfterFilter).toBe(false);
    });
  });

  it("falls back to the file name when a photo has no EXIF", () => {
    const store = new FakePhotoFileStore({
      files: { [MONTH_FOLDER]: ["IMG_20190609_143501.jpg", "scan.jpg", "IMG_20190615_1.jpg"] },
      headers: {
        [`${MONTH_FOLDER}/IMG_20190609_143501.jpg`]: buildJpegWithExif({ withoutExif: true }),
        // scan.jpg is unreadable entirely -- readHeader returns undefined.
        [`${MONTH_FOLDER}/IMG_20190615_1.jpg`]: buildJpegWithExif({ withoutExif: true }),
      },
    });

    return listPhotosInFolder(store, { date: DATE, relativePath: MONTH_FOLDER }).then((result) => {
      expect(result.photos.map((photo) => photo.name)).toEqual(["IMG_20190609_143501.jpg"]);
      expect(result.photos[0].matchedBy).toBe("file-name");
      expect(result.photos[0].takenAt).toBeUndefined();
    });
  });

  it("trusts EXIF over a contradicting file name", () => {
    // A photo taken just after midnight: the file name says the 9th, the shutter says
    // the 10th. Honouring the name would file it on the wrong journal entry.
    const store = new FakePhotoFileStore({
      files: { [MONTH_FOLDER]: ["IMG_20190609_235959.jpg"] },
      headers: { [`${MONTH_FOLDER}/IMG_20190609_235959.jpg`]: taken("2019:06:10") },
    });

    return listPhotosInFolder(store, { date: DATE, relativePath: MONTH_FOLDER }).then((result) => {
      expect(result.photos).toEqual([]);
      expect(result.isEmptyAfterFilter).toBe(true);
    });
  });

  it("flags an empty result from a non-empty folder, so the card can offer the month", () => {
    const store = new FakePhotoFileStore({
      files: { [MONTH_FOLDER]: ["a.jpg", "b.jpg"] },
      headers: {
        [`${MONTH_FOLDER}/a.jpg`]: taken("2019:06:20"),
        [`${MONTH_FOLDER}/b.jpg`]: taken("2019:06:21"),
      },
    });

    return listPhotosInFolder(store, { date: DATE, relativePath: MONTH_FOLDER }).then((result) => {
      expect(result.photos).toEqual([]);
      expect(result.examined).toBe(2);
      expect(result.isEmptyAfterFilter).toBe(true);
    });
  });

  it("returns the whole folder when includeAll is set, reading nothing", () => {
    const store = new FakePhotoFileStore({
      files: { [MONTH_FOLDER]: ["a.jpg", "b.jpg"] },
      headers: { [`${MONTH_FOLDER}/a.jpg`]: taken("2019:06:20") },
    });

    return listPhotosInFolder(store, {
      date: DATE,
      relativePath: MONTH_FOLDER,
      includeAll: true,
    }).then((result) => {
      expect(result.photos.map((photo) => photo.name)).toEqual(["a.jpg", "b.jpg"]);
      expect(result.isEmptyAfterFilter).toBe(false);
      expect(store.readCount).toBe(0);
    });
  });

  it("keeps the folder's sorted order even though headers are read in parallel", async () => {
    // The scan runs in batches of 8, so a folder larger than one batch is needed to
    // catch a regression here. Reads resolve in a deliberately jumbled order.
    const names = Array.from({ length: 20 }, (_, index) => `IMG_${String(index).padStart(3, "0")}.jpg`);
    const headers = Object.fromEntries(
      names.map((name) => [`${MONTH_FOLDER}/${name}`, taken("2019:06:09")]),
    );

    class JumbledStore extends FakePhotoFileStore {
      async readHeader(relativePath: string): Promise<Uint8Array | undefined> {
        // Later files answer sooner, which would reorder a naive implementation.
        const index = names.indexOf(relativePath.split("/").pop() ?? "");
        await new Promise((resolve) => setTimeout(resolve, (names.length - index) % 8));
        return super.readHeader(relativePath);
      }
    }

    const store = new JumbledStore({ files: { [MONTH_FOLDER]: names }, headers });
    const result = await listPhotosInFolder(store, { date: DATE, relativePath: MONTH_FOLDER });

    expect(result.photos.map((photo) => photo.name)).toEqual(names);
  });

  it("treats a folder matching neither convention as a month folder", () => {
    // The conservative default: filter by capture date rather than declare every
    // photo in an arbitrary folder a match.
    const store = new FakePhotoFileStore({
      files: { "2019/Misc Scans": ["a.jpg", "b.jpg"] },
      headers: {
        "2019/Misc Scans/a.jpg": taken("2019:06:09"),
        "2019/Misc Scans/b.jpg": taken("2019:06:10"),
      },
    });

    return listPhotosInFolder(store, { date: DATE, relativePath: "2019/Misc Scans" }).then(
      (result) => {
        expect(result.kind).toBe("month");
        expect(result.photos.map((photo) => photo.name)).toEqual(["a.jpg"]);
      },
    );
  });
});
