import { describe, expect, it } from "vitest";
import { buildJpegWithPreview } from "@/lib/journal-photos/embedded-thumbnail.fixture";
import { FakeArchive, steppingClock, type FakeEntry } from "./fake-archive.fixture";
import { MAX_SCAN, pickTestPhotos, samplePhotos, type ScannedPhoto } from "./pick-test-photos";

/** A JPEG that carries an embedded preview, padded to `total` bytes. */
function withPreview(total: number): Uint8Array {
  const header = buildJpegWithPreview({ orientation: 1 });
  const bytes = new Uint8Array(Math.max(total, header.length));
  bytes.set(header);
  return bytes;
}

const noPreview = (total: number) => new Uint8Array(total);

const photo = (name: string) => ({ relativePath: `2026/2026-02/${name}`, name });

function archiveOf(entries: Record<string, FakeEntry>) {
  const reader = new FakeArchive(
    Object.fromEntries(Object.entries(entries).map(([name, entry]) => [`2026/2026-02/${name}`, entry])),
  );
  return { reader, now: steppingClock() };
}

describe("pickTestPhotos", () => {
  it("scans with a stat and a header, and never reads a whole file", async () => {
    const deps = archiveOf({ "a.jpg": { bytes: withPreview(500), sizeBytes: 3_000_000 } });
    const picked = await pickTestPhotos(deps, [photo("a.jpg")]);

    expect(deps.reader.calls).toEqual([
      "stat 2026/2026-02/a.jpg",
      "header 2026/2026-02/a.jpg",
    ]);
    expect(deps.reader.calls.some((call) => call.startsWith("read "))).toBe(false);
    // The size comes from the stat, not from the bytes the header read returned.
    expect(picked.largest?.bytes).toBe(3_000_000);
  });

  it("picks the smallest, median and largest across the whole folder", async () => {
    const deps = archiveOf({
      "a.jpg": { bytes: withPreview(200), sizeBytes: 1_000 },
      "b.jpg": { bytes: withPreview(200), sizeBytes: 5_000 },
      "c.jpg": { bytes: withPreview(200), sizeBytes: 3_000 },
      "d.jpg": { bytes: withPreview(200), sizeBytes: 2_000 },
      "e.jpg": { bytes: withPreview(200), sizeBytes: 4_000 },
    });
    const picked = await pickTestPhotos(deps, ["a", "b", "c", "d", "e"].map((n) => photo(`${n}.jpg`)));

    expect(picked.smallest?.name).toBe("a.jpg");
    expect(picked.median?.name).toBe("c.jpg");
    expect(picked.largest?.name).toBe("b.jpg");
    expect(picked.bySize.map((p) => p.bytes)).toEqual([1_000, 2_000, 3_000, 4_000, 5_000]);
    expect(picked.scanned).toBe(5);
    expect(picked.scanMs).toBeGreaterThan(0);
  });

  it("counts previews and reports the first photo without one", async () => {
    const deps = archiveOf({
      "a.jpg": { bytes: withPreview(200), sizeBytes: 1_000 },
      "scan.jpg": { bytes: noPreview(200), sizeBytes: 2_000 },
      "c.jpg": { bytes: withPreview(200), sizeBytes: 3_000 },
    });
    const picked = await pickTestPhotos(deps, [photo("a.jpg"), photo("scan.jpg"), photo("c.jpg")]);

    expect(picked.withPreviewCount).toBe(2);
    expect(picked.withoutPreviewCount).toBe(1);
    expect(picked.withoutPreview?.name).toBe("scan.jpg");
    expect(picked.largest?.previewBytes).toBeGreaterThan(0);
  });

  it("leaves withoutPreview unset when every photo has one", async () => {
    const deps = archiveOf({ "a.jpg": { bytes: withPreview(200), sizeBytes: 1_000 } });
    const picked = await pickTestPhotos(deps, [photo("a.jpg")]);
    expect(picked.withoutPreview).toBeUndefined();
    expect(picked.withoutPreviewCount).toBe(0);
  });

  it("counts a photo whose stat is missing or throws, and keeps scanning", async () => {
    const deps = archiveOf({
      "gone.jpg": { stat: "missing" },
      "broken.jpg": { stat: "throws" },
      "ok.jpg": { bytes: withPreview(200), sizeBytes: 9_000 },
    });
    const picked = await pickTestPhotos(deps, [photo("gone.jpg"), photo("broken.jpg"), photo("ok.jpg")]);

    expect(picked.unreadable).toBe(2);
    expect(picked.scanned).toBe(1);
    expect(picked.largest?.name).toBe("ok.jpg");
  });

  it("still records the size when only the header read fails", async () => {
    const deps = archiveOf({ "a.jpg": { bytes: withPreview(200), sizeBytes: 4_000, header: "missing" } });
    const picked = await pickTestPhotos(deps, [photo("a.jpg")]);

    expect(picked.scanned).toBe(1);
    expect(picked.largest?.bytes).toBe(4_000);
    expect(picked.largest?.hasPreview).toBe(false);
    expect(picked.unreadable).toBe(0);
  });

  it("counts a header read that throws as unreadable", async () => {
    const deps = archiveOf({ "a.jpg": { bytes: withPreview(200), sizeBytes: 4_000, header: "throws" } });
    const picked = await pickTestPhotos(deps, [photo("a.jpg")]);
    expect(picked.unreadable).toBe(1);
    expect(picked.scanned).toBe(0);
  });

  it("stops at the cap and says the folder was capped", async () => {
    const deps = archiveOf({
      "a.jpg": { bytes: withPreview(200), sizeBytes: 1 },
      "b.jpg": { bytes: withPreview(200), sizeBytes: 2 },
      "c.jpg": { bytes: withPreview(200), sizeBytes: 3 },
    });
    const picked = await pickTestPhotos(
      deps,
      [photo("a.jpg"), photo("b.jpg"), photo("c.jpg")],
      2,
    );

    expect(picked.isCapped).toBe(true);
    expect(picked.totalInFolder).toBe(3);
    expect(picked.scanned).toBe(2);
    expect(deps.reader.calls.some((call) => call.includes("c.jpg"))).toBe(false);
  });

  it("is not capped for a folder inside the default limit", async () => {
    const deps = archiveOf({ "a.jpg": { bytes: withPreview(200), sizeBytes: 1 } });
    const picked = await pickTestPhotos(deps, [photo("a.jpg")]);
    expect(picked.isCapped).toBe(false);
    expect(MAX_SCAN).toBeGreaterThan(400);
  });

  it("handles an empty folder without reading anything", async () => {
    const deps = archiveOf({});
    const picked = await pickTestPhotos(deps, []);

    expect(picked.scanned).toBe(0);
    expect(picked.largest).toBeUndefined();
    expect(picked.median).toBeUndefined();
    expect(deps.reader.calls).toEqual([]);
  });
});

describe("samplePhotos", () => {
  const sized = (bytes: number): ScannedPhoto => ({
    relativePath: `p/${bytes}.jpg`,
    name: `${bytes}.jpg`,
    bytes,
    hasPreview: true,
  });
  const bySize = [10, 20, 30, 40, 50, 60, 70].map(sized);

  it("spreads the sample across the range, ends included", () => {
    const picked = samplePhotos(bySize, 4);
    expect(picked.map((p) => p.bytes)).toEqual([10, 30, 50, 70]);
  });

  it("returns everything when the folder has no more than the count", () => {
    expect(samplePhotos(bySize.slice(0, 3), 4).map((p) => p.bytes)).toEqual([10, 20, 30]);
  });

  it("takes the largest when only one is wanted", () => {
    expect(samplePhotos(bySize, 1).map((p) => p.bytes)).toEqual([70]);
  });

  it("returns nothing for an empty list or a count of zero", () => {
    expect(samplePhotos([], 4)).toEqual([]);
    expect(samplePhotos(bySize, 0)).toEqual([]);
  });
});
