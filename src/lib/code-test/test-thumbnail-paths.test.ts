import { describe, expect, it } from "vitest";
import { FAKE_PREVIEW, buildJpegWithPreview } from "@/lib/journal-photos/embedded-thumbnail.fixture";
import { THUMBNAIL_SIZE } from "@/lib/journal-photos/thumbnail";
import { FakeArchive, FakeImageLib, steppingClock, type FakeEntry } from "./fake-archive.fixture";
import type { ScannedPhoto } from "./pick-test-photos";
import { testThumbnailPaths } from "./test-thumbnail-paths";

function withPreview(total: number): Uint8Array {
  const header = buildJpegWithPreview({ orientation: 1 });
  const bytes = new Uint8Array(Math.max(total, header.length));
  bytes.set(header);
  return bytes;
}

const PHOTO: ScannedPhoto = {
  relativePath: "f/a.jpg",
  name: "a.jpg",
  bytes: 3_000_000,
  hasPreview: true,
  previewBytes: FAKE_PREVIEW.length,
};

function depsFor(entry: FakeEntry, imageLib = new FakeImageLib()) {
  return { reader: new FakeArchive({ "f/a.jpg": entry }), imageLib, now: steppingClock() };
}

describe("testThumbnailPaths", () => {
  it("times the preview path against the whole-file path and compares them", async () => {
    const imageLib = new FakeImageLib();
    const report = await testThumbnailPaths(depsFor({ bytes: withPreview(50_000) }, imageLib), {
      photos: [PHOTO],
    });

    expect(report).toContain("Photo:");
    expect(report).toContain("a.jpg");
    expect(report).toContain("preview:");
    expect(report).toContain("original:");
    expect(report).toContain("verdict:");
    expect(report).toContain("128 KB");
    // Both paths shrink to the size the viewer asks for.
    expect(imageLib.resizes.map((r) => r.longEdge)).toEqual([THUMBNAIL_SIZE, THUMBNAIL_SIZE]);
    // The preview path resized the small embedded JPEG; the fallback the whole file.
    expect(imageLib.resizes[0].bytes).toBe(FAKE_PREVIEW.length);
    expect(imageLib.resizes[1].bytes).toBe(50_000);
  });

  it("reads only the header for the preview path, and the whole file for the fallback", async () => {
    const deps = depsFor({ bytes: withPreview(50_000) });
    await testThumbnailPaths(deps, { photos: [PHOTO] });

    expect(deps.reader.calls).toEqual(["header f/a.jpg", "read f/a.jpg"]);
  });

  it("says the preview path does not apply to a photo without one", async () => {
    const imageLib = new FakeImageLib();
    const report = await testThumbnailPaths(depsFor({ bytes: new Uint8Array(50_000) }, imageLib), {
      photos: [{ ...PHOTO, hasPreview: false, previewBytes: undefined }],
    });

    expect(report).toContain("no embedded preview, so this path does not apply");
    // Only the fallback resized.
    expect(imageLib.resizes).toHaveLength(1);
    expect(report).not.toContain("verdict:");
  });

  it("reports an unreadable header as a line", async () => {
    const report = await testThumbnailPaths(
      depsFor({ bytes: withPreview(50_000), header: "missing" }),
      { photos: [PHOTO] },
    );
    expect(report).toContain("header unreadable");
    expect(report).toContain("original:");
  });

  it("reports a header read that throws as a line", async () => {
    const report = await testThumbnailPaths(
      depsFor({ bytes: withPreview(50_000), header: "throws" }),
      { photos: [PHOTO] },
    );
    expect(report).toContain("header read failed: header failed: share dropped");
  });

  it("reports a missing original as a line", async () => {
    const report = await testThumbnailPaths(
      depsFor({ bytes: withPreview(50_000), read: "missing" }),
      { photos: [PHOTO] },
    );
    expect(report).toContain("original:");
    expect(report).toContain("unreadable");
  });

  it("reports a read that throws as a line", async () => {
    const report = await testThumbnailPaths(
      depsFor({ bytes: withPreview(50_000), read: "throws" }),
      { photos: [PHOTO] },
    );
    expect(report).toContain("read failed: read failed: share dropped");
  });

  it("reports a resize that throws, for each path separately", async () => {
    const report = await testThumbnailPaths(
      depsFor({ bytes: withPreview(50_000) }, new FakeImageLib({ failBytes: FAKE_PREVIEW.length })),
      { photos: [PHOTO] },
    );

    expect(report).toContain("resizing the preview failed: resize failed: out of memory");
    // The fallback still ran and reported.
    expect(report).toContain("original:");
    expect(report).not.toContain("verdict:");
  });

  it("covers every photo it is given", async () => {
    const reader = new FakeArchive({
      "f/a.jpg": { bytes: withPreview(10_000) },
      "f/b.jpg": { bytes: withPreview(20_000) },
    });
    const report = await testThumbnailPaths(
      { reader, imageLib: new FakeImageLib(), now: steppingClock() },
      { photos: [PHOTO, { ...PHOTO, relativePath: "f/b.jpg", name: "b.jpg" }] },
    );

    expect(report).toContain("a.jpg");
    expect(report).toContain("b.jpg");
  });

  it("skips when nothing was scanned", async () => {
    const imageLib = new FakeImageLib();
    const report = await testThumbnailPaths(depsFor({ bytes: withPreview(10) }, imageLib), {
      photos: [],
    });

    expect(report).toBe("Skipped. No photo could be scanned.");
    expect(imageLib.resizes).toEqual([]);
  });
});
