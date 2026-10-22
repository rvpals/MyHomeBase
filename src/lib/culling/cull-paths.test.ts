import { beforeAll, describe, expect, it } from "vitest";
import { cullPhotoPaths } from "./cull-paths";
import {
  blurredCheckerboardJpeg,
  checkerboardJpeg,
  nearDuplicateOf,
  underexposedJpeg,
} from "./fixture";
import type { CullingImageStore } from "./ports";
import type { PhotoRootCheck } from "../journal-photos";

// The cross-folder use-case. Shares the sharp decode with `cull.test.ts`, so the
// fixtures are generated once here too.

let sharpImage: Uint8Array;
let blurredImage: Uint8Array;
let darkImage: Uint8Array;
let duplicateImage: Uint8Array;

beforeAll(async () => {
  sharpImage = await checkerboardJpeg();
  blurredImage = await blurredCheckerboardJpeg();
  darkImage = await underexposedJpeg();
  duplicateImage = await nearDuplicateOf(sharpImage);
}, 30_000);

/**
 * A store keyed by FULL relative path, spanning folders.
 *
 * Deliberately not `FakeCullingImageStore`, which keys on the bare file name — the
 * whole point here is that two photographs in different folders are different files.
 */
class PathStore implements CullingImageStore {
  constructor(
    private readonly files: Map<string, Uint8Array>,
    private readonly rootCheck: PhotoRootCheck = { kind: "ok", path: "/fake/root" },
  ) {}

  async checkRoot(): Promise<PhotoRootCheck> {
    return this.rootCheck;
  }

  async listImageNames(): Promise<string[]> {
    throw new Error("cullPhotoPaths must not list folders.");
  }

  async listUndecodableNames(): Promise<string[]> {
    throw new Error("cullPhotoPaths must not list folders.");
  }

  async readImage(relativePath: string): Promise<Uint8Array | undefined> {
    return this.files.get(relativePath);
  }
}

function storeOf(files: Record<string, Uint8Array>) {
  return new PathStore(new Map(Object.entries(files)));
}

describe("cullPhotoPaths", () => {
  it("scores photographs from different folders in one batch", async () => {
    const result = await cullPhotoPaths(
      storeOf({
        "2019/2019-06/sharp.jpg": sharpImage,
        "2021/2021-03 Trip/blurred.jpg": blurredImage,
      }),
      ["2019/2019-06/sharp.jpg", "2021/2021-03 Trip/blurred.jpg"],
    );

    expect(result.keepers[0].name).toBe("sharp.jpg");
    expect(result.examined).toBe(2);
  });

  it("groups near-duplicates across folders, not just within one", async () => {
    const result = await cullPhotoPaths(
      storeOf({
        "2019/2019-06/original.jpg": sharpImage,
        "2021/2021-03 Trip/copy.jpg": duplicateImage,
      }),
      ["2019/2019-06/original.jpg", "2021/2021-03 Trip/copy.jpg"],
    );

    expect(result.keepers).toHaveLength(1);
    expect(result.rejects).toHaveLength(1);
    expect(result.rejects[0].rejectReason).toBe("duplicate");
  });

  it("keeps genuinely different photographs from different folders", async () => {
    const result = await cullPhotoPaths(
      storeOf({
        "2019/a.jpg": sharpImage,
        "2021/b.jpg": darkImage,
      }),
      ["2019/a.jpg", "2021/b.jpg"],
    );

    expect(result.keepers).toHaveLength(2);
    expect(result.duplicateGroups).toBe(0);
  });

  it("reports the requested count alongside the examined one", async () => {
    const result = await cullPhotoPaths(
      storeOf({ "2019/a.jpg": sharpImage }),
      ["2019/a.jpg"],
    );

    expect(result.requested).toBe(1);
    expect(result.examined).toBe(1);
    expect(result.wasTruncated).toBe(false);
  });

  it("truncates a set past the ceiling rather than refusing it", async () => {
    const files: Record<string, Uint8Array> = {};
    const paths: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const path = `2019/IMG_${index}.jpg`;
      files[path] = index % 2 === 0 ? sharpImage : darkImage;
      paths.push(path);
    }

    const result = await cullPhotoPaths(storeOf(files), paths, { maxImages: 3 });

    expect(result.requested).toBe(5);
    expect(result.examined).toBe(3);
    expect(result.wasTruncated).toBe(true);
  });

  it("truncates from the front, keeping the caller's order", async () => {
    const result = await cullPhotoPaths(
      storeOf({
        "2019/first.jpg": sharpImage,
        "2019/second.jpg": darkImage,
        "2019/third.jpg": blurredImage,
      }),
      ["2019/first.jpg", "2019/second.jpg", "2019/third.jpg"],
      { maxImages: 2 },
    );

    const judged = [...result.keepers, ...result.rejects].map((photo) => photo.name);
    expect(judged).not.toContain("third.jpg");
  });

  it("reports an unsafe path as unreadable instead of reading it", async () => {
    const result = await cullPhotoPaths(
      storeOf({ "2019/a.jpg": sharpImage }),
      ["2019/a.jpg", "../../etc/passwd"],
    );

    expect(result.keepers).toHaveLength(1);
    expect(result.unreadable).toHaveLength(1);
    expect(result.unreadable[0].error).toMatch(/not a safe/i);
  });

  it("does not fail the set because one path is bad", async () => {
    const result = await cullPhotoPaths(
      storeOf({ "2019/good.jpg": sharpImage }),
      ["2019/good.jpg", "2019/missing.jpg"],
    );

    expect(result.keepers).toHaveLength(1);
    expect(result.unreadable).toHaveLength(1);
  });

  it("records a corrupt file without losing the rest", async () => {
    const result = await cullPhotoPaths(
      storeOf({
        "2019/good.jpg": sharpImage,
        "2019/broken.jpg": new Uint8Array([1, 2, 3]),
      }),
      ["2019/good.jpg", "2019/broken.jpg"],
    );

    expect(result.keepers).toHaveLength(1);
    expect(result.unreadable[0].name).toBe("broken.jpg");
  });

  it("honours a keep limit", async () => {
    const result = await cullPhotoPaths(
      storeOf({
        "2019/a.jpg": sharpImage,
        "2019/b.jpg": blurredImage,
        "2019/c.jpg": darkImage,
      }),
      ["2019/a.jpg", "2019/b.jpg", "2019/c.jpg"],
      { keepCount: 1 },
    );

    expect(result.keepers).toHaveLength(1);
    expect(result.rejects).toHaveLength(2);
  });

  it("returns an empty result for an empty set rather than throwing", async () => {
    const result = await cullPhotoPaths(storeOf({}), []);

    expect(result.keepers).toEqual([]);
    expect(result.requested).toBe(0);
    expect(result.wasTruncated).toBe(false);
  });

  it("reports why the archive is unusable rather than returning nothing", async () => {
    const store = new PathStore(new Map(), { kind: "not-configured" });

    await expect(cullPhotoPaths(store, ["2019/a.jpg"])).rejects.toThrow(/not-configured/);
  });

  it("carries the full path through, not just the file name", async () => {
    const result = await cullPhotoPaths(
      storeOf({ "2019/2019-06 June/a.jpg": sharpImage }),
      ["2019/2019-06 June/a.jpg"],
    );

    expect(result.keepers[0].relativePath).toBe("2019/2019-06 June/a.jpg");
    expect(result.keepers[0].name).toBe("a.jpg");
  });
});
