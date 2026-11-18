import { describe, expect, it } from "vitest";
import { FAKE_PREVIEW, buildJpegWithPreview } from "@/lib/journal-photos/embedded-thumbnail.fixture";
import { buildJpegWithExif } from "@/lib/journal-photos/exif.fixture";
import type { ImageLibInfo, ImageLibProbe, ImageMetadata, TimedPhotoReader } from "./ports";
import { RESIZE_LONG_EDGES, testServerResizeImage } from "./test-server-resize-image";

const PATH = "2019/2019-06-09 Von Thun Farm/DSC00123.jpg";

class FakeReader implements TimedPhotoReader {
  reads: string[] = [];
  constructor(private readonly file: Uint8Array | undefined | Error) {}
  async read(relativePath: string) {
    this.reads.push(relativePath);
    if (this.file instanceof Error) throw this.file;
    return this.file === undefined ? undefined : { data: this.file, ms: 812 };
  }
}

const INFO: ImageLibInfo = { version: "0.35.4", detail: "libvips 8.17.1", platform: "linux", arch: "arm64" };

class FakeImageLib implements ImageLibProbe {
  resized: number[] = [];
  constructor(
    private readonly options: { unavailable?: boolean; alreadyLoaded?: boolean; metadata?: ImageMetadata } = {},
  ) {}
  async load() {
    if (this.options.unavailable) throw new Error("the sharp module failed to load (ERR_DLOPEN_FAILED)");
    return { ms: this.options.alreadyLoaded ? undefined : 143, info: INFO };
  }
  async metadata(): Promise<ImageMetadata> {
    return this.options.metadata ?? { width: 4000, height: 3000, orientation: 6 };
  }
  async resize(_bytes: Uint8Array, longEdge: number) {
    this.resized.push(longEdge);
    // Output size proportional to the edge, so each line's numbers differ.
    return { data: new Uint8Array(longEdge), ms: longEdge / 10 };
  }
}

/** A clock that advances 1,000 ms per call, so the total is predictable. */
function steppingClock() {
  let t = 0;
  return () => {
    t += 1000;
    return t;
  };
}

/** A photo big enough for percentages to mean something: the fixture, padded. */
function photoBytes(header: Uint8Array, total = 100_000): Uint8Array {
  const bytes = new Uint8Array(total);
  bytes.set(header);
  return bytes;
}

describe("testServerResizeImage", () => {
  it("reports the file, the original, the library and each resize", async () => {
    const reader = new FakeReader(photoBytes(buildJpegWithPreview({ orientation: 6 })));
    const imageLib = new FakeImageLib();
    const report = await testServerResizeImage(
      { reader, imageLib, now: steppingClock() },
      { relativePath: PATH },
    );

    expect(report).toContain(`Path:           ${PATH}`);
    expect(report).toContain("File:           100,000 bytes (0.10 MB), read from the NAS in 812 ms");
    expect(report).toContain("Original:       4000 x 3000, EXIF orientation 6");
    expect(report).toContain("sharp load:     143 ms (first use)");
    expect(report).toContain("sharp version:  0.35.4 (libvips 8.17.1)");
    expect(report).toContain("Platform:       linux arm64");
    expect(report).toContain("Resize 160px:   16 ms, 160 bytes, 99.8% smaller");
    expect(report).toContain("Resize 1024px:  102 ms, 1,024 bytes, 99.0% smaller");
    expect(report).toContain("Resize 2048px:  205 ms, 2,048 bytes, 98.0% smaller");
    expect(report).toContain("Total:          1,000 ms");
    expect(imageLib.resized).toEqual([...RESIZE_LONG_EDGES]);
    expect(report).not.toContain("Error");
  });

  it("reports an EXIF preview's size and orientation when there is one", async () => {
    const reader = new FakeReader(photoBytes(buildJpegWithPreview({ orientation: 8 })));
    const report = await testServerResizeImage(
      { reader, imageLib: new FakeImageLib(), now: steppingClock() },
      { relativePath: PATH },
    );
    expect(report).toContain(`EXIF preview:   present, ${FAKE_PREVIEW.length} bytes, orientation 8`);
  });

  it("says so when the photo carries no EXIF preview", async () => {
    const reader = new FakeReader(photoBytes(buildJpegWithExif({ dateTimeOriginal: "2019:06:09 14:35:01" })));
    const report = await testServerResizeImage(
      { reader, imageLib: new FakeImageLib(), now: steppingClock() },
      { relativePath: PATH },
    );
    expect(report).toContain("EXIF preview:   not present");
  });

  it("notes when sharp was already loaded, instead of a load time", async () => {
    const reader = new FakeReader(photoBytes(buildJpegWithPreview()));
    const report = await testServerResizeImage(
      { reader, imageLib: new FakeImageLib({ alreadyLoaded: true }), now: steppingClock() },
      { relativePath: PATH },
    );
    expect(report).toContain("sharp load:     already loaded in this server process");
  });

  it("rejects an unsafe path without reading anything", async () => {
    const reader = new FakeReader(photoBytes(buildJpegWithPreview()));
    const report = await testServerResizeImage(
      { reader, imageLib: new FakeImageLib(), now: steppingClock() },
      { relativePath: "../../etc/passwd.jpg" },
    );
    expect(report).toContain("Error:          Not a safe path relative to the photo root.");
    expect(reader.reads).toEqual([]);
  });

  it("rejects a full filesystem path, absolute or with a drive letter", async () => {
    for (const relativePath of ["/etc/photo.jpg", "C:/Windows/photo.jpg"]) {
      const reader = new FakeReader(photoBytes(buildJpegWithPreview()));
      const report = await testServerResizeImage(
        { reader, imageLib: new FakeImageLib(), now: steppingClock() },
        { relativePath },
      );
      expect(report, relativePath).toContain("Error:          Not a safe path");
      expect(reader.reads, relativePath).toEqual([]);
    }
  });

  it("reports a missing or unreadable file as a line, not a throw", async () => {
    const report = await testServerResizeImage(
      { reader: new FakeReader(undefined), imageLib: new FakeImageLib(), now: steppingClock() },
      { relativePath: PATH },
    );
    expect(report).toContain("Error:          The photo is missing or unreadable.");
    expect(report).toContain("Total:");
  });

  it("reports a read that throws (a dropped share) as a line", async () => {
    const report = await testServerResizeImage(
      { reader: new FakeReader(new Error("share dropped")), imageLib: new FakeImageLib(), now: steppingClock() },
      { relativePath: PATH },
    );
    expect(report).toContain("Error:          Reading the photo failed: share dropped");
  });

  it("says sharp is unavailable, and still reports the file and preview", async () => {
    const reader = new FakeReader(photoBytes(buildJpegWithPreview()));
    const imageLib = new FakeImageLib({ unavailable: true });
    const report = await testServerResizeImage(
      { reader, imageLib, now: steppingClock() },
      { relativePath: PATH },
    );
    expect(report).toContain("File:           100,000 bytes");
    expect(report).toContain("EXIF preview:   present");
    expect(report).toContain("sharp:          unavailable: the sharp module failed to load (ERR_DLOPEN_FAILED)");
    expect(report).toContain("Resize:         skipped, because sharp did not load");
    expect(imageLib.resized).toEqual([]);
  });
});
