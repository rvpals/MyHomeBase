import { beforeAll, describe, expect, it } from "vitest";
import { cullFolder } from "./cull";
import {
  blurredCheckerboardJpeg,
  checkerboardJpeg,
  FakeCullingImageStore,
  nearDuplicateOf,
  overexposedJpeg,
  underexposedJpeg,
} from "./fixture";

// The one test that exercises the real sharp decode. Everything else in this module is
// pure and tested against hand-built arrays.

const FOLDER = "2019/2019-06";

let sharpImage: Uint8Array;
let blurredImage: Uint8Array;
let darkImage: Uint8Array;
let blownImage: Uint8Array;
let duplicateImage: Uint8Array;

beforeAll(async () => {
  // Generated once: encoding five JPEGs per test case would dominate the run.
  sharpImage = await checkerboardJpeg();
  blurredImage = await blurredCheckerboardJpeg();
  darkImage = await underexposedJpeg();
  blownImage = await overexposedJpeg();
  duplicateImage = await nearDuplicateOf(sharpImage);
}, 30_000);

/** A store holding the named files. */
function storeOf(files: Record<string, Uint8Array>, undecodable: string[] = []) {
  return new FakeCullingImageStore(new Map(Object.entries(files)), undecodable);
}

describe("cullFolder", () => {
  it("ranks the sharp image above the blurred one", async () => {
    const result = await cullFolder(
      storeOf({ "sharp.jpg": sharpImage, "blurred.jpg": blurredImage }),
      FOLDER,
    );

    expect(result.keepers[0].name).toBe("sharp.jpg");
    expect(result.keepers[0].score).toBeGreaterThan(result.keepers[1].score);
  });

  it("describes the sharp image as sharp and the blurred one as soft", async () => {
    const result = await cullFolder(
      storeOf({ "sharp.jpg": sharpImage, "blurred.jpg": blurredImage }),
      FOLDER,
    );

    const byName = new Map(result.keepers.map((photo) => [photo.name, photo.reason]));
    expect(byName.get("sharp.jpg")).toContain("sharp");
    expect(byName.get("blurred.jpg")).toContain("soft");
  });

  it("ranks a well-exposed frame above an underexposed one", async () => {
    const result = await cullFolder(
      storeOf({ "good.jpg": sharpImage, "dark.jpg": darkImage }),
      FOLDER,
    );

    expect(result.keepers[0].name).toBe("good.jpg");
  });

  it("flags the underexposed frame in its reason", async () => {
    const result = await cullFolder(
      storeOf({ "good.jpg": sharpImage, "dark.jpg": darkImage }),
      FOLDER,
    );

    const dark = result.keepers.find((photo) => photo.name === "dark.jpg");
    expect(dark?.reason).toContain("underexposed");
  });

  it("flags an overexposed frame in its reason", async () => {
    const result = await cullFolder(
      storeOf({ "good.jpg": sharpImage, "blown.jpg": blownImage }),
      FOLDER,
    );

    const blown = result.keepers.find((photo) => photo.name === "blown.jpg");
    expect(blown?.reason).toContain("overexposed");
  });

  it("groups a near-duplicate pair and keeps only one of them", async () => {
    const result = await cullFolder(
      storeOf({ "original.jpg": sharpImage, "copy.jpg": duplicateImage }),
      FOLDER,
    );

    expect(result.keepers).toHaveLength(1);
    expect(result.rejects).toHaveLength(1);
    expect(result.duplicateGroups).toBe(1);
  });

  it("marks the loser of a duplicate pair as a duplicate of the keeper", async () => {
    const result = await cullFolder(
      storeOf({ "original.jpg": sharpImage, "copy.jpg": duplicateImage }),
      FOLDER,
    );

    expect(result.rejects[0].rejectReason).toBe("duplicate");
    expect(result.rejects[0].duplicateOf).toBe(result.keepers[0].relativePath);
  });

  it("keeps genuinely different images rather than grouping them", async () => {
    const result = await cullFolder(
      storeOf({ "sharp.jpg": sharpImage, "dark.jpg": darkImage }),
      FOLDER,
    );

    expect(result.keepers).toHaveLength(2);
    expect(result.duplicateGroups).toBe(0);
  });

  it("keeps every non-duplicate when no keep limit is given", async () => {
    const result = await cullFolder(
      storeOf({ "a.jpg": sharpImage, "b.jpg": blurredImage, "c.jpg": darkImage }),
      FOLDER,
    );

    expect(result.keepers).toHaveLength(3);
    expect(result.rejects).toHaveLength(0);
  });

  it("cuts to keepCount, rejecting the rest", async () => {
    const result = await cullFolder(
      storeOf({ "a.jpg": sharpImage, "b.jpg": blurredImage, "c.jpg": darkImage }),
      FOLDER,
      { keepCount: 1 },
    );

    expect(result.keepers).toHaveLength(1);
    expect(result.keepers[0].name).toBe("a.jpg");
    expect(result.rejects).toHaveLength(2);
  });

  it("cuts to keepFraction", async () => {
    const result = await cullFolder(
      storeOf({ "a.jpg": sharpImage, "b.jpg": blurredImage, "c.jpg": darkImage, "d.jpg": blownImage }),
      FOLDER,
      { keepFraction: 0.5 },
    );

    expect(result.keepers).toHaveLength(2);
  });

  it("records a corrupt file as unreadable instead of failing the batch", async () => {
    const result = await cullFolder(
      storeOf({ "good.jpg": sharpImage, "broken.jpg": new Uint8Array([1, 2, 3, 4]) }),
      FOLDER,
    );

    expect(result.keepers).toHaveLength(1);
    expect(result.keepers[0].name).toBe("good.jpg");
    expect(result.unreadable).toHaveLength(1);
    expect(result.unreadable[0].name).toBe("broken.jpg");
  });

  it("reports HEIC files as unreadable with a reason naming the limitation", async () => {
    const result = await cullFolder(
      storeOf({ "good.jpg": sharpImage }, ["IMG_0001.heic"]),
      FOLDER,
    );

    expect(result.unreadable).toHaveLength(1);
    expect(result.unreadable[0].error).toContain("HEIC");
    expect(result.examined).toBe(2);
  });

  it("counts every file it considered, readable or not", async () => {
    const result = await cullFolder(
      storeOf({ "a.jpg": sharpImage, "bad.jpg": new Uint8Array([0, 1]) }, ["b.heic"]),
      FOLDER,
    );

    expect(result.examined).toBe(3);
  });

  it("returns an empty result for an empty folder rather than throwing", async () => {
    const result = await cullFolder(storeOf({}), FOLDER);

    expect(result.keepers).toEqual([]);
    expect(result.rejects).toEqual([]);
    expect(result.examined).toBe(0);
  });

  it("carries the original pixel dimensions through, not the analysis size", async () => {
    const result = await cullFolder(storeOf({ "a.jpg": sharpImage }), FOLDER);

    expect(result.keepers[0].width).toBe(256);
    expect(result.keepers[0].height).toBe(256);
  });

  it("normalises the folder it reports", async () => {
    const result = await cullFolder(storeOf({ "a.jpg": sharpImage }), "2019//2019-06/");

    expect(result.folder).toBe("2019/2019-06");
  });

  it("refuses a path that escapes the archive root", async () => {
    await expect(cullFolder(storeOf({}), "../../etc")).rejects.toThrow(/not a safe/i);
  });

  it("refuses an absolute path", async () => {
    await expect(cullFolder(storeOf({}), "/etc/passwd")).rejects.toThrow(/not a safe/i);
  });

  it("reports why the archive is unusable rather than returning nothing", async () => {
    const store = new FakeCullingImageStore(new Map(), [], { kind: "not-configured" });

    await expect(cullFolder(store, FOLDER)).rejects.toThrow(/not-configured/);
  });

  it("scores only the named photos when `only` is given", async () => {
    const result = await cullFolder(
      storeOf({ "a.jpg": sharpImage, "b.jpg": blurredImage, "c.jpg": darkImage }),
      FOLDER,
      { only: ["a.jpg", "b.jpg"] },
    );

    expect(result.examined).toBe(2);
    expect(result.keepers.map((photo) => photo.name).sort()).toEqual(["a.jpg", "b.jpg"]);
  });

  it("ignores a requested name the folder does not hold, rather than failing", async () => {
    const result = await cullFolder(
      storeOf({ "a.jpg": sharpImage }),
      FOLDER,
      { only: ["a.jpg", "deleted-since.jpg"] },
    );

    expect(result.examined).toBe(1);
    expect(result.keepers).toHaveLength(1);
  });

  it("does not read a name outside the folder listing", async () => {
    // The names arrive from a browser; one that is not in the listing must not become
    // a read just because the caller asked for it.
    const result = await cullFolder(
      storeOf({ "a.jpg": sharpImage }),
      FOLDER,
      { only: ["../../secret.jpg"] },
    );

    expect(result.examined).toBe(0);
    expect(result.keepers).toEqual([]);
  });

  it("leaves a HEIC outside the selection unreported", async () => {
    const result = await cullFolder(
      storeOf({ "a.jpg": sharpImage }, ["elsewhere.heic"]),
      FOLDER,
      { only: ["a.jpg"] },
    );

    expect(result.unreadable).toEqual([]);
  });

  it("refuses a set larger than the ceiling rather than running for minutes", async () => {
    const many: Record<string, Uint8Array> = {};
    for (let index = 0; index < 5; index += 1) many[`IMG_${index}.jpg`] = sharpImage;

    // A small explicit ceiling, so the test does not have to encode 300 files.
    await expect(cullFolder(storeOf(many), FOLDER, { maxImages: 3 })).rejects.toThrow(
      /more than the 3 /,
    );
  });

  it("honours a raised ceiling from the caller", async () => {
    const many: Record<string, Uint8Array> = {};
    for (let index = 0; index < 5; index += 1) many[`IMG_${index}.jpg`] = sharpImage;

    const result = await cullFolder(storeOf(many), FOLDER, { maxImages: 10 });
    expect(result.examined).toBe(5);
  });

  it("honours a tightened duplicate threshold", async () => {
    const loose = await cullFolder(
      storeOf({ "original.jpg": sharpImage, "copy.jpg": duplicateImage }),
      FOLDER,
      { duplicateDistance: 10 },
    );
    const strict = await cullFolder(
      storeOf({ "original.jpg": sharpImage, "copy.jpg": duplicateImage }),
      FOLDER,
      { duplicateDistance: 0 },
    );

    expect(loose.keepers.length).toBeLessThanOrEqual(strict.keepers.length);
  });
});
