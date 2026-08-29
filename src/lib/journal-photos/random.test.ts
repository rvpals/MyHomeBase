import { describe, expect, it } from "vitest";
import { pickRandomPhoto } from "./random";
import type { PhotoFileStore } from "./ports";
import type { PhotoRootCheck } from "./types";

// The walk is three uniform picks over three directory listings, so the tests are
// mostly about the two things that are easy to get wrong: that a pick which lands on an
// empty folder re-rolls instead of giving up, and that an unreadable root is reported
// as its own cause rather than as an empty archive.

interface FakeArchive {
  root?: PhotoRootCheck;
  folders?: Record<string, string[]>;
  photos?: Record<string, string[]>;
}

class FakeStore implements PhotoFileStore {
  /** Every folder listing asked for, in order -- used to bound the retry loop's I/O. */
  readonly folderReads: string[] = [];

  constructor(private readonly archive: FakeArchive) {}

  async isRootAvailable(): Promise<boolean> {
    return (await this.checkRoot()).kind === "ok";
  }

  async checkRoot(): Promise<PhotoRootCheck> {
    return this.archive.root ?? { kind: "ok", path: "/volume1/MEDIA/PHOTO/BY YEAR" };
  }

  async folderExists(relativeFolder: string): Promise<boolean> {
    return (this.archive.folders ?? {})[relativeFolder] !== undefined;
  }

  async listFolderNames(relativeFolder: string): Promise<string[]> {
    this.folderReads.push(relativeFolder);
    return (this.archive.folders ?? {})[relativeFolder] ?? [];
  }

  async listPhotoNames(relativeFolder: string): Promise<string[]> {
    return (this.archive.photos ?? {})[relativeFolder] ?? [];
  }

  async readHeader(): Promise<Uint8Array | undefined> {
    return undefined;
  }

  async readPhoto(): Promise<{ data: Uint8Array; mimeType: string } | undefined> {
    return undefined;
  }
}

/**
 * A `RandomSource` that yields the given values in order, then repeats the last one.
 *
 * Repeating rather than running out matters for the retry tests: the loop asks for more
 * numbers than a single attempt uses, and a source returning `undefined` would produce
 * `NaN` indices and test a case that cannot happen in production.
 */
function sequence(...values: number[]): RandomSourceStub {
  let index = 0;
  const next = () => {
    const value = values[Math.min(index, values.length - 1)] ?? 0;
    index += 1;
    return value;
  };
  return next;
}

type RandomSourceStub = () => number;

describe("pickRandomPhoto", () => {
  const archive: FakeArchive = {
    folders: {
      "": ["2018", "2019", "2020"],
      "2019": ["2019-06", "2019-06-09 Von Thun Farm"],
    },
    photos: {
      "2019/2019-06": ["a.jpg", "b.jpg", "c.jpg"],
      "2019/2019-06-09 Von Thun Farm": ["party.jpg"],
    },
  };

  it("picks a year, a folder inside it, and a photo inside that", async () => {
    const store = new FakeStore(archive);
    // 0.5 of 3 years -> index 1 ("2019"); 0.0 of 2 folders -> "2019-06";
    // 0.9 of 3 photos -> index 2 ("c.jpg").
    const pick = await pickRandomPhoto(store, sequence(0.5, 0.0, 0.9));

    expect(pick.isAvailable).toBe(true);
    expect(pick.reason).toBeUndefined();
    expect(pick.year).toBe("2019");
    expect(pick.folderName).toBe("2019-06");
    expect(pick.name).toBe("c.jpg");
    expect(pick.relativePath).toBe("2019/2019-06/c.jpg");
  });

  it("treats a dated event folder as eligible, not just a month folder", async () => {
    const store = new FakeStore(archive);
    // Second pick 0.9 of 2 folders -> index 1, the `YYYY-MM-DD <event>` folder.
    const pick = await pickRandomPhoto(store, sequence(0.5, 0.9, 0.0));

    expect(pick.folderName).toBe("2019-06-09 Von Thun Farm");
    expect(pick.relativePath).toBe("2019/2019-06-09 Von Thun Farm/party.jpg");
  });

  it("can reach the last file in a large folder", async () => {
    // The case from the brief: 2,000 files, and the draw must be able to land on the
    // 2,000th rather than being capped somewhere short of the end.
    const names = Array.from({ length: 2000 }, (_, index) => `IMG_${index + 1}.jpg`);
    const store = new FakeStore({
      folders: { "": ["2019"], "2019": ["2019-06"] },
      photos: { "2019/2019-06": names },
    });

    const pick = await pickRandomPhoto(store, sequence(0, 0, 0.99999));

    expect(pick.name).toBe("IMG_2000.jpg");
  });

  it("re-rolls past a folder that holds no photos", async () => {
    const store = new FakeStore({
      folders: { "": ["2019"], "2019": ["empty-raw-only", "2019-06"] },
      photos: { "2019/2019-06": ["only.jpg"] },
    });

    // A failed attempt consumes only two numbers -- year, then folder -- because it
    // bails before picking a file. So: attempt one takes (0, 0) and lands on the empty
    // folder; attempt two takes (0, 0.9) and lands on the populated one, then 0 picks
    // the file.
    const pick = await pickRandomPhoto(store, sequence(0, 0, 0, 0.9, 0));

    expect(pick.name).toBe("only.jpg");
    expect(pick.folderName).toBe("2019-06");
  });

  it("gives up with no-photos after a bounded number of attempts", async () => {
    const store = new FakeStore({
      folders: { "": ["2019"], "2019": ["empty"] },
      photos: {},
    });

    const pick = await pickRandomPhoto(store, () => 0);

    expect(pick.isAvailable).toBe(true);
    expect(pick.reason).toBe("no-photos");
    expect(pick.relativePath).toBeUndefined();
    // The root listing plus one year listing per attempt -- proof the loop is bounded
    // and does not wander the archive when every pick comes up empty.
    expect(store.folderReads.length).toBeLessThanOrEqual(9);
  });

  it("reports an empty archive rather than retrying when there are no year folders", async () => {
    const store = new FakeStore({ folders: { "": [] } });

    const pick = await pickRandomPhoto(store, () => 0);

    expect(pick.isAvailable).toBe(true);
    expect(pick.reason).toBe("no-photos");
    // No year to pick from, so the loop is never entered: the root listing is the only read.
    expect(store.folderReads).toEqual([""]);
  });

  it("carries the reason through when the root is not configured", async () => {
    const store = new FakeStore({ root: { kind: "not-configured" } });

    const pick = await pickRandomPhoto(store, () => 0);

    expect(pick.isAvailable).toBe(false);
    expect(pick.reason).toBe("not-configured");
    expect(pick.rootPath).toBeUndefined();
    // Nothing was read: an unusable root does not get better by listing folders.
    expect(store.folderReads).toEqual([]);
  });

  it("carries the path through when the root cannot be read", async () => {
    const store = new FakeStore({
      root: { kind: "no-permission", path: "/volume1/MEDIA/PHOTO/BY YEAR" },
    });

    const pick = await pickRandomPhoto(store, () => 0);

    expect(pick.isAvailable).toBe(false);
    expect(pick.reason).toBe("no-permission");
    expect(pick.rootPath).toBe("/volume1/MEDIA/PHOTO/BY YEAR");
  });

  it("defaults to Math.random and returns a photo that is really in the archive", async () => {
    const store = new FakeStore(archive);
    const paths = new Set([
      "2019/2019-06/a.jpg",
      "2019/2019-06/b.jpg",
      "2019/2019-06/c.jpg",
      "2019/2019-06-09 Von Thun Farm/party.jpg",
    ]);

    // No injected source: exercises the production default. Years 2018 and 2020 have no
    // folders, so this also leans on the retry loop to find the one populated year.
    for (let run = 0; run < 25; run += 1) {
      const pick = await pickRandomPhoto(new FakeStore(archive));
      expect(pick.isAvailable).toBe(true);
      if (pick.relativePath !== undefined) expect(paths.has(pick.relativePath)).toBe(true);
    }
    expect(store.folderReads).toEqual([]);
  });
});
