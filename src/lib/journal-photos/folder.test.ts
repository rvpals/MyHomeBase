import { describe, expect, it } from "vitest";
import { listAllPhotosInFolder } from "./folder";
import type { PhotoFileStore } from "./ports";
import type { PhotoRootCheck } from "./types";

// The same hand-written in-memory store as photos.test.ts, for the same reason: the
// assertions are about which photos come back, and a fake lets the archive shape be
// written down as data. `readCount` matters more here than there -- this use-case
// exists BECAUSE it opens no files, so a test that proves the count stays zero is
// testing the actual point of the function.

interface FakeArchive {
  files: Record<string, string[]>;
  isRootAvailable?: boolean;
  rootProblem?: "not-configured" | "missing" | "no-permission" | "not-a-directory" | "unreachable";
}

class FakePhotoFileStore implements PhotoFileStore {
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

  async readHeader(): Promise<Uint8Array | undefined> {
    this.readCount += 1;
    return undefined;
  }

  async readPhoto(): Promise<{ data: Uint8Array; mimeType: string } | undefined> {
    return undefined;
  }
}

const EVENT_FOLDER = "2019/2019-06-09 Von Thun Farm Strawberry Festival Washington";
const MONTH_FOLDER = "2019/2019-06";

describe("listAllPhotosInFolder", () => {
  it("returns every photo in the folder, sorted, with joined relative paths", () => {
    const store = new FakePhotoFileStore({
      files: { [EVENT_FOLDER]: ["IMG_2.jpg", "IMG_1.jpg", "IMG_3.jpeg"] },
    });

    return listAllPhotosInFolder(store, { relativePath: EVENT_FOLDER }).then((result) => {
      expect(result.isAvailable).toBe(true);
      expect(result.photos.map((photo) => photo.name)).toEqual([
        "IMG_1.jpg",
        "IMG_2.jpg",
        "IMG_3.jpeg",
      ]);
      // The path the image route will be asked for, folder and name joined.
      expect(result.photos[0].relativePath).toBe(`${EVENT_FOLDER}/IMG_1.jpg`);
      expect(result.photos[0].matchedBy).toBe("folder");
    });
  });

  it("opens no files, even for a month folder", () => {
    // The entire reason this function exists rather than a flag on `listPhotosInFolder`:
    // a month folder there costs one header read per JPEG. Here it must cost none.
    const store = new FakePhotoFileStore({
      files: { [MONTH_FOLDER]: ["a.jpg", "b.jpg", "c.jpg", "d.jpg"] },
    });

    return listAllPhotosInFolder(store, { relativePath: MONTH_FOLDER }).then((result) => {
      expect(result.photos).toHaveLength(4);
      expect(store.readCount).toBe(0);
    });
  });

  it("ignores non-photo files and does not recurse into sub-folders", () => {
    const store = new FakePhotoFileStore({
      files: {
        "2019": ["notes.txt"],
        [EVENT_FOLDER]: ["IMG_1.jpg", "notes.txt", "RAW_1.arw"],
      },
    });

    return Promise.all([
      listAllPhotosInFolder(store, { relativePath: EVENT_FOLDER }),
      // The year folder holds event folders, not photos -- a flat listing, so the
      // honest answer is "nothing here", not the whole year's pictures.
      listAllPhotosInFolder(store, { relativePath: "2019" }),
    ]).then(([event, year]) => {
      expect(event.photos.map((photo) => photo.name)).toEqual(["IMG_1.jpg"]);
      expect(year.isAvailable).toBe(true);
      expect(year.photos).toEqual([]);
    });
  });

  it("reports an empty folder as available with no photos", () => {
    // Distinct from `missing` below: the folder is there, it just holds nothing the
    // viewer can show.
    const store = new FakePhotoFileStore({ files: { [EVENT_FOLDER]: [] } });

    return listAllPhotosInFolder(store, { relativePath: EVENT_FOLDER }).then((result) => {
      expect(result.isAvailable).toBe(true);
      expect(result.reason).toBeUndefined();
      expect(result.photos).toEqual([]);
    });
  });

  it("reports a folder that has moved or been renamed as missing", () => {
    const store = new FakePhotoFileStore({ files: { [EVENT_FOLDER]: ["IMG_1.jpg"] } });

    return listAllPhotosInFolder(store, { relativePath: "2019/2019-06-09 Renamed" }).then(
      (result) => {
        expect(result.isAvailable).toBe(false);
        expect(result.reason).toBe("missing");
        expect(result.photos).toEqual([]);
      },
    );
  });

  it("refuses a traversal path without touching the store", () => {
    const store = new FakePhotoFileStore({ files: { [EVENT_FOLDER]: ["IMG_1.jpg"] } });

    return listAllPhotosInFolder(store, { relativePath: "2019/../../etc" }).then((result) => {
      expect(result.isAvailable).toBe(false);
      expect(result.reason).toBe("unsafe-path");
      expect(result.photos).toEqual([]);
    });
  });

  it("normalises a Windows-style path so a folder with spaces still matches", () => {
    // Folder names in this archive are full of spaces, and a path can arrive with
    // backslashes from a caller that built it from a native path.
    const store = new FakePhotoFileStore({ files: { [EVENT_FOLDER]: ["IMG_1.jpg"] } });

    return listAllPhotosInFolder(store, {
      relativePath: EVENT_FOLDER.replace(/\//g, "\\"),
    }).then((result) => {
      expect(result.isAvailable).toBe(true);
      expect(result.relativePath).toBe(EVENT_FOLDER);
      expect(result.photos).toHaveLength(1);
    });
  });

  it("carries the root problem when the archive is unreachable", () => {
    const store = new FakePhotoFileStore({
      files: {},
      isRootAvailable: false,
      rootProblem: "unreachable",
    });

    return listAllPhotosInFolder(store, { relativePath: EVENT_FOLDER }).then((result) => {
      expect(result.isAvailable).toBe(false);
      expect(result.reason).toBe("unreachable");
    });
  });
});
