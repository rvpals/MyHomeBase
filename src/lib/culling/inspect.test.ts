import { beforeAll, describe, expect, it } from "vitest";
import { exposureVerdict, inspectPhoto } from "./inspect";
import {
  blurredCheckerboardJpeg,
  checkerboardJpeg,
  overexposedJpeg,
  underexposedJpeg,
} from "./fixture";
import type { CullingImageStore } from "./ports";
import type { PhotoRootCheck } from "../journal-photos";

// Single-photograph measurement. The decode is real `sharp`, so the fixtures are
// generated once -- the same arrangement `cull.test.ts` and `cull-paths.test.ts` use.

let sharpImage: Uint8Array;
let blurredImage: Uint8Array;
let darkImage: Uint8Array;
let brightImage: Uint8Array;

beforeAll(async () => {
  sharpImage = await checkerboardJpeg();
  blurredImage = await blurredCheckerboardJpeg();
  darkImage = await underexposedJpeg();
  brightImage = await overexposedJpeg();
}, 30_000);

/** A store keyed by full relative path. `inspectPhoto` must never list a folder. */
class PathStore implements CullingImageStore {
  constructor(
    private readonly files: Map<string, Uint8Array>,
    private readonly rootCheck: PhotoRootCheck = { kind: "ok", path: "/fake/root" },
    private readonly readThrows = false,
  ) {}

  async checkRoot(): Promise<PhotoRootCheck> {
    return this.rootCheck;
  }

  async listImageNames(): Promise<string[]> {
    throw new Error("inspectPhoto must not list folders.");
  }

  async listUndecodableNames(): Promise<string[]> {
    throw new Error("inspectPhoto must not list folders.");
  }

  async readImage(relativePath: string): Promise<Uint8Array | undefined> {
    if (this.readThrows) throw new Error("SMB share went away.");
    return this.files.get(relativePath);
  }
}

function storeOf(files: Record<string, Uint8Array>) {
  return new PathStore(new Map(Object.entries(files)));
}

describe("inspectPhoto", () => {
  it("measures one photograph and reports its own numbers", async () => {
    const store = storeOf({ "2019/2019-06/sharp.jpg": sharpImage });

    const result = await inspectPhoto(store, "2019/2019-06/sharp.jpg");

    expect(result.kind).toBe("measured");
    if (result.kind !== "measured") return;

    expect(result.relativePath).toBe("2019/2019-06/sharp.jpg");
    expect(result.name).toBe("sharp.jpg");
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    // Absolute measurements, not ranks: a lone photograph still has real numbers.
    expect(result.metrics.sharpness).toBeGreaterThan(0);
    expect(result.metrics.brightness).toBeGreaterThanOrEqual(0);
    expect(result.metrics.brightness).toBeLessThanOrEqual(255);
  });

  it("carries no score and no keeper verdict", async () => {
    // The whole reason this use-case exists rather than a one-path cull: with nothing
    // to rank against, a score would be a fabricated 0.5. Guarded as a test because a
    // future hand might 'helpfully' add one back.
    const store = storeOf({ "a/b.jpg": sharpImage });

    const result = await inspectPhoto(store, "a/b.jpg");

    expect(result).not.toHaveProperty("score");
    expect(result).not.toHaveProperty("isKeeper");
    expect(result).not.toHaveProperty("reason");
  });

  it("distinguishes a sharp frame from a blurred one by measurement", async () => {
    const store = storeOf({ "a/sharp.jpg": sharpImage, "a/blur.jpg": blurredImage });

    const sharpResult = await inspectPhoto(store, "a/sharp.jpg");
    const blurResult = await inspectPhoto(store, "a/blur.jpg");

    if (sharpResult.kind !== "measured" || blurResult.kind !== "measured") {
      throw new Error("both fixtures should measure");
    }
    // The comparison a ranked one-photo cull could never make, because both would have
    // scored exactly 0.5.
    expect(sharpResult.metrics.sharpness).toBeGreaterThan(blurResult.metrics.sharpness);
  });

  it("names clipping when a frame is blown out or crushed", async () => {
    const store = storeOf({ "a/bright.jpg": brightImage, "a/dark.jpg": darkImage });

    const bright = await inspectPhoto(store, "a/bright.jpg");
    const dark = await inspectPhoto(store, "a/dark.jpg");

    if (bright.kind !== "measured" || dark.kind !== "measured") {
      throw new Error("both fixtures should measure");
    }
    expect(bright.exposure).toBe("overexposed");
    expect(dark.exposure).toBe("underexposed");
    // Quoted out so a panel can show the threshold it was judged against.
    expect(bright.clipTolerance).toBeGreaterThan(0);
  });

  it("reports an unreadable file instead of throwing", async () => {
    const store = storeOf({ "a/b.jpg": sharpImage });

    const result = await inspectPhoto(store, "a/missing.jpg");

    expect(result.kind).toBe("unreadable");
    if (result.kind !== "unreadable") return;
    expect(result.name).toBe("missing.jpg");
    expect(result.error).toMatch(/could not be read/i);
  });

  it("reports bytes that are not a decodable image", async () => {
    const store = storeOf({ "a/not-an-image.jpg": new Uint8Array([1, 2, 3, 4, 5]) });

    const result = await inspectPhoto(store, "a/not-an-image.jpg");

    expect(result.kind).toBe("unreadable");
  });

  it("reports a read that throws rather than letting it escape", async () => {
    // One flaky SMB read must not take down the card with an unhandled rejection.
    const store = new PathStore(new Map(), { kind: "ok", path: "/fake/root" }, true);

    const result = await inspectPhoto(store, "a/b.jpg");

    expect(result.kind).toBe("unreadable");
    if (result.kind !== "unreadable") return;
    expect(result.error).toMatch(/SMB share went away/);
  });

  it("rejects a path that escapes the archive root", async () => {
    const store = storeOf({});

    // A throw, not an "unreadable" result: this is an attack or a bug, never a fact
    // about a file.
    await expect(inspectPhoto(store, "../../etc/passwd")).rejects.toThrow(/not a safe/i);
  });

  it("throws when the archive root itself is unusable", async () => {
    // A broken root affects every photo, so reporting it as "this file is unreadable"
    // would send the reader hunting for a corrupt JPEG that does not exist.
    const store = new PathStore(new Map(), { kind: "missing", path: "/gone" });

    await expect(inspectPhoto(store, "a/b.jpg")).rejects.toThrow(/not usable/i);
  });
});

describe("exposureVerdict", () => {
  const metrics = {
    sharpness: 100,
    centerSharpness: 100,
    brightness: 128,
    contrast: 50,
    shadowClipping: 0,
    highlightClipping: 0,
  };

  it("says nothing when neither end is clipped", () => {
    expect(exposureVerdict(metrics)).toBe("no-clipping");
  });

  it("prefers highlights when a backlit frame clips at both ends", () => {
    // Matches `describeScore`'s ordering on purpose: one picture must not be
    // "overexposed" in one panel and "underexposed" in another.
    const bothEnds = { ...metrics, shadowClipping: 0.5, highlightClipping: 0.5 };
    expect(exposureVerdict(bothEnds)).toBe("overexposed");
  });

  it("ignores clipping within tolerance", () => {
    const aLittle = { ...metrics, highlightClipping: 0.001 };
    expect(exposureVerdict(aLittle)).toBe("no-clipping");
  });
});
