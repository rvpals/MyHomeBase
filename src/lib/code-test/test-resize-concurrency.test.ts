import { describe, expect, it } from "vitest";
import { FakeArchive, FakeImageLib, steppingClock } from "./fake-archive.fixture";
import type { ScannedPhoto } from "./pick-test-photos";
import { CONCURRENCY_LONG_EDGE, CONCURRENCY_WIDTHS, testResizeConcurrency } from "./test-resize-concurrency";

const scanned = (name: string, bytes: number): ScannedPhoto => ({
  relativePath: `f/${name}`,
  name,
  bytes,
  hasPreview: true,
});

const PHOTOS = [scanned("a.jpg", 100), scanned("b.jpg", 200), scanned("c.jpg", 300)];

function archive(overrides: Record<string, { read?: "missing" | "throws" }> = {}) {
  return new FakeArchive({
    "f/a.jpg": { bytes: new Uint8Array(100), ...overrides["f/a.jpg"] },
    "f/b.jpg": { bytes: new Uint8Array(200), ...overrides["f/b.jpg"] },
    "f/c.jpg": { bytes: new Uint8Array(300), ...overrides["f/c.jpg"] },
  });
}

describe("testResizeConcurrency", () => {
  it("times the batch at every gate width and names the best", async () => {
    const imageLib = new FakeImageLib();
    const report = await testResizeConcurrency(
      { reader: archive(), imageLib, now: steppingClock() },
      { photos: PHOTOS },
    );

    for (const width of CONCURRENCY_WIDTHS) {
      expect(report, `width ${width}`).toContain(`${width} at once:`);
    }
    expect(report).toContain("1 at once:");
    expect(report).toContain("baseline");
    expect(report).toContain("Reading:");
    // Every photo, at every width, at the served size.
    expect(imageLib.resizes).toHaveLength(PHOTOS.length * CONCURRENCY_WIDTHS.length);
    expect(imageLib.resizes.every((r) => r.longEdge === CONCURRENCY_LONG_EDGE)).toBe(true);
  });

  it("reads each photo once, before timing, not once per width", async () => {
    const reader = archive();
    await testResizeConcurrency(
      { reader, imageLib: new FakeImageLib(), now: steppingClock() },
      { photos: PHOTOS },
    );

    const reads = reader.calls.filter((call) => call.startsWith("read "));
    expect(reads).toEqual(["read f/a.jpg", "read f/b.jpg", "read f/c.jpg"]);
  });

  it("never runs more at once than the widest gate", async () => {
    const imageLib = new FakeImageLib();
    await testResizeConcurrency(
      { reader: archive(), imageLib, now: steppingClock() },
      { photos: PHOTOS },
    );
    expect(imageLib.peakInFlight).toBeLessThanOrEqual(Math.max(...CONCURRENCY_WIDTHS));
  });

  it("cannot overlap a batch of one photo", async () => {
    const imageLib = new FakeImageLib();
    await testResizeConcurrency(
      { reader: archive(), imageLib, now: steppingClock() },
      { photos: [PHOTOS[0]] },
    );
    expect(imageLib.peakInFlight).toBe(1);
  });

  it("notes photos it could not read, and still times the rest", async () => {
    const reader = archive({ "f/b.jpg": { read: "missing" } });
    const imageLib = new FakeImageLib();
    const report = await testResizeConcurrency(
      { reader, imageLib, now: steppingClock() },
      { photos: PHOTOS },
    );

    expect(report).toContain("Unread:         1 of the batch could not be read");
    expect(report).toContain("Bytes held:     2 photos");
    expect(imageLib.resizes).toHaveLength(2 * CONCURRENCY_WIDTHS.length);
  });

  it("counts a read that throws rather than failing the experiment", async () => {
    const reader = archive({ "f/a.jpg": { read: "throws" } });
    const report = await testResizeConcurrency(
      { reader, imageLib: new FakeImageLib(), now: steppingClock() },
      { photos: PHOTOS },
    );
    expect(report).toContain("Unread:         1 of the batch");
    expect(report).toContain("1 at once:");
  });

  it("stops with a line when nothing in the batch can be read", async () => {
    const reader = archive({
      "f/a.jpg": { read: "missing" },
      "f/b.jpg": { read: "missing" },
      "f/c.jpg": { read: "missing" },
    });
    const imageLib = new FakeImageLib();
    const report = await testResizeConcurrency(
      { reader, imageLib, now: steppingClock() },
      { photos: PHOTOS },
    );

    expect(report).toContain("Nothing to resize: every photo in the batch failed to read.");
    expect(imageLib.resizes).toEqual([]);
  });

  it("counts a failing resize and still reports the width", async () => {
    // The 200-byte photo throws; the other two resize normally.
    const imageLib = new FakeImageLib({ failBytes: 200 });
    const report = await testResizeConcurrency(
      { reader: archive(), imageLib, now: steppingClock() },
      { photos: PHOTOS },
    );

    expect(report).toContain("1 failed");
    expect(report).toContain("1 at once:");
  });

  it("skips an empty batch", async () => {
    const imageLib = new FakeImageLib();
    const report = await testResizeConcurrency(
      { reader: archive(), imageLib, now: steppingClock() },
      { photos: [] },
    );

    expect(report).toBe("Skipped. No photo could be scanned.");
    expect(imageLib.resizes).toEqual([]);
  });

  it("says running them at once does not help when every width costs the same", async () => {
    // A stepping clock advances the same amount per batch, so no width wins.
    const report = await testResizeConcurrency(
      { reader: archive(), imageLib: new FakeImageLib(), now: steppingClock() },
      { photos: PHOTOS },
    );
    expect(report).toContain("does NOT help");
  });
});
