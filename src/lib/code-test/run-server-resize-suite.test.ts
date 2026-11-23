import { describe, expect, it } from "vitest";
import { buildJpegWithPreview } from "@/lib/journal-photos/embedded-thumbnail.fixture";
import { FakeArchive, FakeImageLib, steppingClock, type FakeEntry } from "./fake-archive.fixture";
import { runServerResizeSuite } from "./run-server-resize-suite";

function withPreview(total: number): Uint8Array {
  const header = buildJpegWithPreview({ orientation: 1 });
  const bytes = new Uint8Array(Math.max(total, header.length));
  bytes.set(header);
  return bytes;
}

const FOLDER = "2026/2026-02";
const named = (name: string) => ({ relativePath: `${FOLDER}/${name}`, name });

function suiteDeps(entries: Record<string, FakeEntry>, imageLib = new FakeImageLib()) {
  const reader = new FakeArchive(
    Object.fromEntries(Object.entries(entries).map(([name, entry]) => [`${FOLDER}/${name}`, entry])),
  );
  return { reader, imageLib, now: steppingClock() };
}

/** Four photos of distinct sizes, all carrying a preview -- a normal camera folder. */
const NORMAL_FOLDER: Record<string, FakeEntry> = {
  "a.jpg": { bytes: withPreview(1_000), sizeBytes: 1_000_000 },
  "b.jpg": { bytes: withPreview(1_000), sizeBytes: 2_000_000 },
  "c.jpg": { bytes: withPreview(1_000), sizeBytes: 3_000_000 },
  "d.jpg": { bytes: withPreview(1_000), sizeBytes: 4_000_000 },
};
const NORMAL_NAMES = ["a.jpg", "b.jpg", "c.jpg", "d.jpg"].map(named);

describe("runServerResizeSuite", () => {
  it("runs all four sections and totals the suite", async () => {
    const report = await runServerResizeSuite(suiteDeps(NORMAL_FOLDER), {
      folderPath: FOLDER,
      photos: NORMAL_NAMES,
    });

    expect(report).toContain("Server image resize suite");
    expect(report).toContain(`Folder:         ${FOLDER}`);
    expect(report).toContain("=== 1 of 4: Folder scan ===");
    expect(report).toContain("=== 2 of 4: Resize sizes ===");
    expect(report).toContain("=== 3 of 4: Thumbnail paths ===");
    expect(report).toContain("=== 4 of 4: Concurrency ===");
    expect(report).toContain("Suite total:");
  });

  it("reports the scan's method, counts and size distribution", async () => {
    const report = await runServerResizeSuite(suiteDeps(NORMAL_FOLDER), {
      folderPath: FOLDER,
      photos: NORMAL_NAMES,
    });

    expect(report).toContain("Scanned:        4 of 4 photos in");
    expect(report).toContain("no whole file was read");
    expect(report).toContain("EXIF previews:  4 have one, 0 do not");
    expect(report).toContain("Smallest:       a.jpg, 1,000,000 bytes (0.95 MB)");
    expect(report).toContain("Largest:        d.jpg, 4,000,000 bytes (3.81 MB)");
    expect(report).toContain("Median:         c.jpg");
  });

  it("resizes the median and the largest, as two labelled subjects", async () => {
    const report = await runServerResizeSuite(suiteDeps(NORMAL_FOLDER), {
      folderPath: FOLDER,
      photos: NORMAL_NAMES,
    });

    expect(report).toContain("Subject:        median size -- c.jpg");
    expect(report).toContain("Subject:        largest file -- d.jpg");
    expect(report).toContain("Resize 160px:");
    expect(report).toContain("Resize 2048px:");
  });

  it("does not run the same photo twice when median and largest coincide", async () => {
    const report = await runServerResizeSuite(
      suiteDeps({ "only.jpg": { bytes: withPreview(1_000), sizeBytes: 500_000 } }),
      { folderPath: FOLDER, photos: [named("only.jpg")] },
    );

    expect(report).toContain("median size -- only.jpg");
    expect(report).not.toContain("largest file --");
  });

  it("includes a photo with no preview in the thumbnail section when the folder has one", async () => {
    const report = await runServerResizeSuite(
      suiteDeps({
        ...NORMAL_FOLDER,
        "scan.jpg": { bytes: new Uint8Array(1_000), sizeBytes: 1_500_000 },
      }),
      { folderPath: FOLDER, photos: [...NORMAL_NAMES, named("scan.jpg")] },
    );

    expect(report).toContain("No preview:     e.g. scan.jpg");
    expect(report).toContain("EXIF previews:  4 have one, 1 do not");
    expect(report).toContain("no embedded preview, so this path does not apply");
  });

  it("reports an empty folder and runs nothing", async () => {
    const deps = suiteDeps({});
    const report = await runServerResizeSuite(deps, { folderPath: FOLDER, photos: [] });

    expect(report).toContain("No photos in that folder. Nothing was run.");
    expect(report).not.toContain("=== 1 of 4");
    expect(deps.reader.calls).toEqual([]);
    expect(deps.imageLib.resizes).toEqual([]);
  });

  it("stops after the scan when nothing in the folder can be read", async () => {
    const deps = suiteDeps({ "a.jpg": { stat: "missing" }, "b.jpg": { stat: "throws" } });
    const report = await runServerResizeSuite(deps, {
      folderPath: FOLDER,
      photos: [named("a.jpg"), named("b.jpg")],
    });

    expect(report).toContain("=== 1 of 4: Folder scan ===");
    expect(report).toContain("2 unreadable");
    expect(report).toContain("Nothing could be scanned, so no experiment ran.");
    expect(report).not.toContain("=== 2 of 4");
    expect(report).toContain("Suite total:");
    expect(deps.imageLib.resizes).toEqual([]);
  });

  it("never throws when the image library is unavailable", async () => {
    const imageLib = new FakeImageLib();
    imageLib.load = async () => {
      throw new Error("the sharp module failed to load (ERR_DLOPEN_FAILED)");
    };
    const report = await runServerResizeSuite(suiteDeps(NORMAL_FOLDER, imageLib), {
      folderPath: FOLDER,
      photos: NORMAL_NAMES,
    });

    expect(report).toContain("sharp:          unavailable:");
    expect(report).toContain("Resize:         skipped, because sharp did not load");
    expect(report).toContain("Suite total:");
  });
});
