import { describe, expect, it } from "vitest";
import { buildJpegWithPreview } from "@/lib/journal-photos/embedded-thumbnail.fixture";
import type { ImageLibProbe, TimedPhotoReader } from "./ports";
import { pickTestPhotos } from "./pick-test-photos";
import { runServerResizeSuite } from "./run-server-resize-suite";

function padded(header: Uint8Array, total: number): Uint8Array {
  const bytes = new Uint8Array(Math.max(total, header.length));
  bytes.set(header);
  return bytes;
}

const WITH_PREVIEW = (total: number) => padded(buildJpegWithPreview({ orientation: 1 }), total);
const WITHOUT_PREVIEW = (total: number) => new Uint8Array(total);

class MapReader implements TimedPhotoReader {
  reads: string[] = [];
  constructor(private readonly files: Record<string, Uint8Array | Error | undefined>) {}
  async read(relativePath: string) {
    this.reads.push(relativePath);
    const file = this.files[relativePath];
    if (file instanceof Error) throw file;
    return file === undefined ? undefined : { data: file, ms: 5 };
  }
}

const photo = (name: string) => ({ relativePath: `f/${name}`, name });

describe("pickTestPhotos", () => {
  it("picks one with a preview, one without, and the largest", async () => {
    const reader = new MapReader({
      "f/a.jpg": WITH_PREVIEW(1000),
      "f/b.jpg": WITHOUT_PREVIEW(2000),
      "f/c.jpg": WITHOUT_PREVIEW(9000),
    });
    const picked = await pickTestPhotos(reader, [photo("a.jpg"), photo("b.jpg"), photo("c.jpg")]);
    expect(picked.withPreview?.name).toBe("a.jpg");
    expect(picked.largest?.name).toBe("c.jpg");
    // Not the largest, so the three tests are three photos.
    expect(picked.withoutPreview?.name).toBe("b.jpg");
    expect(picked.withPreviewCount).toBe(1);
    expect(picked.withoutPreviewCount).toBe(2);
  });

  it("reuses the largest when it is the only photo of its kind", async () => {
    const reader = new MapReader({ "f/a.jpg": WITH_PREVIEW(1000), "f/b.jpg": WITHOUT_PREVIEW(9000) });
    const picked = await pickTestPhotos(reader, [photo("a.jpg"), photo("b.jpg")]);
    expect(picked.withoutPreview?.name).toBe("b.jpg");
    expect(picked.largest?.name).toBe("b.jpg");
  });

  it("leaves a role empty when the folder has no photo of that kind", async () => {
    const reader = new MapReader({ "f/a.jpg": WITHOUT_PREVIEW(100) });
    const picked = await pickTestPhotos(reader, [photo("a.jpg")]);
    expect(picked.withPreview).toBeUndefined();
    expect(picked.withoutPreview?.name).toBe("a.jpg");
  });

  it("counts unreadable files and skips them", async () => {
    const reader = new MapReader({
      "f/a.jpg": undefined,
      "f/b.jpg": new Error("EIO"),
      "f/c.jpg": WITHOUT_PREVIEW(100),
    });
    const picked = await pickTestPhotos(reader, [photo("a.jpg"), photo("b.jpg"), photo("c.jpg")]);
    expect(picked.unreadable).toBe(2);
    expect(picked.scanned).toBe(1);
    expect(picked.largest?.name).toBe("c.jpg");
  });

  it("stops reading at the cap and says so", async () => {
    const reader = new MapReader({
      "f/a.jpg": WITHOUT_PREVIEW(1),
      "f/b.jpg": WITHOUT_PREVIEW(1),
      "f/c.jpg": WITHOUT_PREVIEW(1),
    });
    const picked = await pickTestPhotos(reader, [photo("a.jpg"), photo("b.jpg"), photo("c.jpg")], 2);
    expect(reader.reads).toEqual(["f/a.jpg", "f/b.jpg"]);
    expect(picked.isCapped).toBe(true);
    expect(picked.totalInFolder).toBe(3);
  });

  it("handles an empty folder", async () => {
    const picked = await pickTestPhotos(new MapReader({}), []);
    expect(picked.scanned).toBe(0);
    expect(picked.largest).toBeUndefined();
  });
});

describe("runServerResizeSuite", () => {
  const imageLib: ImageLibProbe = {
    async load() {
      return { ms: undefined, info: { version: "1", detail: "", platform: "linux", arch: "arm64" } };
    },
    async metadata() {
      return { width: 10, height: 10 };
    },
    async resize(_bytes, longEdge) {
      return { data: new Uint8Array(longEdge), ms: 1 };
    },
  };

  it("runs three headed tests on the picked photos", async () => {
    const reader = new MapReader({ "f/a.jpg": WITH_PREVIEW(5000), "f/b.jpg": WITHOUT_PREVIEW(6000) });
    const report = await runServerResizeSuite(
      { reader, imageLib, now: () => 0 },
      { folderPath: "f", photos: [photo("a.jpg"), photo("b.jpg")] },
    );
    expect(report).toContain("=== Test 1 of 3: has an EXIF preview ===");
    expect(report).toContain("=== Test 2 of 3: no EXIF preview ===");
    expect(report).toContain("=== Test 3 of 3: largest file ===");
    expect(report).toContain("Path:           f/a.jpg");
    expect(report).toContain("Resize 160px:");
  });

  it("skips a test with no matching photo instead of failing", async () => {
    const reader = new MapReader({ "f/a.jpg": WITHOUT_PREVIEW(100) });
    const report = await runServerResizeSuite(
      { reader, imageLib, now: () => 0 },
      { folderPath: "f", photos: [photo("a.jpg")] },
    );
    expect(report).toContain("Skipped. No scanned photo has an EXIF preview.");
  });

  it("reports an empty folder without running anything", async () => {
    const reader = new MapReader({});
    const report = await runServerResizeSuite(
      { reader, imageLib, now: () => 0 },
      { folderPath: "f", photos: [] },
    );
    expect(report).toContain("No photos in that folder");
    expect(reader.reads).toEqual([]);
  });
});
