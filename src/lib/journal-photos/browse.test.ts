import { describe, expect, it } from "vitest";
import { ancestorFolders, joinArchivePath, listArchiveFolder } from "./browse";
import type { PhotoFileStore } from "./ports";
import type { PhotoRootCheck } from "./types";

// A hand-written in-memory archive, like folder.test.ts, but root-aware: the tree starts
// at `""`, which the other fakes never had to answer for. `readCount` stays at zero for
// the same reason as there -- browsing is directory listings and nothing else.

interface FakeArchive {
  files: Record<string, string[]>;
  rootProblem?: Exclude<PhotoRootCheck["kind"], "ok">;
}

const prefixOf = (folder: string) => (folder === "" ? "" : `${folder}/`);

class FakePhotoFileStore implements PhotoFileStore {
  readCount = 0;
  constructor(private readonly archive: FakeArchive) {}

  async isRootAvailable() {
    return (await this.checkRoot()).kind === "ok";
  }
  async checkRoot(): Promise<PhotoRootCheck> {
    return this.archive.rootProblem === undefined
      ? { kind: "ok", path: "/fake" }
      : { kind: this.archive.rootProblem, path: "/fake" };
  }
  async folderExists(folder: string) {
    return Object.keys(this.archive.files).some(
      (path) => path === folder || path.startsWith(`${folder}/`),
    );
  }
  async listFolderNames(folder: string) {
    const prefix = prefixOf(folder);
    const names = new Set<string>();
    for (const path of Object.keys(this.archive.files)) {
      if (!path.startsWith(prefix) || path === folder) continue;
      const rest = path.slice(prefix.length);
      if (rest !== "") names.add(rest.split("/")[0]);
    }
    return [...names].sort();
  }
  async listPhotoNames(folder: string) {
    return (this.archive.files[folder] ?? []).filter((n) => /\.jpe?g$/i.test(n)).sort();
  }
  async readHeader() {
    this.readCount += 1;
    return undefined;
  }
  async readPhoto() {
    this.readCount += 1;
    return undefined;
  }
  async statPhoto() {
    return undefined;
  }
}

const ARCHIVE: FakeArchive = {
  files: {
    "": ["cover.jpg"],
    "2018/2018-12 December": ["a.jpg"],
    "2019": ["notes.txt"],
    "2019/2019-06-09 Strawberry Festival": ["IMG_2.jpg", "IMG_1.jpg", "RAW_1.arw"],
  },
};

describe("listArchiveFolder", () => {
  it("lists the archive root's folders and photos", async () => {
    const store = new FakePhotoFileStore(ARCHIVE);
    const result = await listArchiveFolder(store, { relativePath: "" });

    expect(result).toEqual({
      relativePath: "",
      isAvailable: true,
      folders: ["2018", "2019"],
      photos: ["cover.jpg"],
    });
    expect(store.readCount).toBe(0);
  });

  it("lists one nested level, JPEGs only, without recursing", async () => {
    const store = new FakePhotoFileStore(ARCHIVE);

    const year = await listArchiveFolder(store, { relativePath: "2019" });
    expect(year.folders).toEqual(["2019-06-09 Strawberry Festival"]);
    expect(year.photos).toEqual([]);

    const event = await listArchiveFolder(store, {
      relativePath: "2019\\2019-06-09 Strawberry Festival/",
    });
    expect(event.relativePath).toBe("2019/2019-06-09 Strawberry Festival");
    expect(event.photos).toEqual(["IMG_1.jpg", "IMG_2.jpg"]);
  });

  it("refuses a traversal path without touching the store", async () => {
    const store = new FakePhotoFileStore(ARCHIVE);
    const result = await listArchiveFolder(store, { relativePath: "2019/../../etc" });
    expect(result).toMatchObject({ isAvailable: false, reason: "unsafe-path", folders: [] });
  });

  it("reports a missing folder as missing, not as empty", async () => {
    const store = new FakePhotoFileStore(ARCHIVE);
    const result = await listArchiveFolder(store, { relativePath: "2042" });
    expect(result).toMatchObject({ isAvailable: false, reason: "missing" });
  });

  it("carries the root problem through", async () => {
    const store = new FakePhotoFileStore({ ...ARCHIVE, rootProblem: "unreachable" });
    const result = await listArchiveFolder(store, { relativePath: "" });
    expect(result).toMatchObject({ isAvailable: false, reason: "unreachable", photos: [] });
  });
});

describe("joinArchivePath", () => {
  it("joins under the root without a leading slash", () => {
    expect(joinArchivePath("", "2019")).toBe("2019");
    expect(joinArchivePath("2019/", "a.jpg")).toBe("2019/a.jpg");
  });
});

describe("ancestorFolders", () => {
  it("returns the folders to expand for a photo, root first", () => {
    expect(ancestorFolders("2019/2019-06 June/IMG_1.jpg", true)).toEqual([
      "2019",
      "2019/2019-06 June",
    ]);
  });

  it("includes the folder itself when given a folder", () => {
    expect(ancestorFolders("2019/2019-06 June", false)).toEqual(["2019", "2019/2019-06 June"]);
  });

  it("is empty for a photo at the root", () => {
    expect(ancestorFolders("cover.jpg", true)).toEqual([]);
    expect(ancestorFolders("", false)).toEqual([]);
  });
});
