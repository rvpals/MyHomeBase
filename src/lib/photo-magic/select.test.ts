import { describe, expect, it } from "vitest";
import { describeGeneration, selectPhotos } from "./select";
import type { IndexedPhoto, PhotoMagicCriteria } from "./types";
import { emptyCriteria } from "./types";

// The draw is the feature: a different set of pictures each time. These tests pin down
// that it samples rather than truncates, that the ceiling is respected, and that the
// stats tell the truth about WHY a result came out thin -- which is what stops a
// correctly-working search from looking broken.

function photos(count: number): IndexedPhoto[] {
  return Array.from({ length: count }, (_, index) => ({
    relativePath: `2019/2019-06 June/IMG_${String(index).padStart(4, "0")}.jpg`,
    bytes: 1024 * (index + 1),
    width: 1920,
    height: 1080,
    takenAtDate: "2019-06-09",
    takenAtSource: "exif" as const,
  }));
}

function criteria(overrides: Partial<PhotoMagicCriteria> = {}): PhotoMagicCriteria {
  return { ...emptyCriteria(), ...overrides };
}

/** A deterministic source: always picks the last remaining item in the shuffle. */
const alwaysZero = () => 0;

/** A cycling source, so a shuffle actually rearranges rather than reversing. */
function cyclingRandom(values: number[]) {
  let index = 0;
  return () => values[index++ % values.length]!;
}

describe("selectPhotos", () => {
  it("returns every candidate when there are fewer than the ceiling", () => {
    const result = selectPhotos(photos(5), criteria({ maxPhotos: 10 }), alwaysZero);
    expect(result.photos).toHaveLength(5);
    expect(result.stats.candidateCount).toBe(5);
    expect(result.stats.selectedCount).toBe(5);
    expect(result.stats.cappedByLimit).toBe(false);
  });

  it("draws no more than the ceiling", () => {
    const result = selectPhotos(photos(100), criteria({ maxPhotos: 10 }), alwaysZero);
    expect(result.photos).toHaveLength(10);
    expect(result.stats.selectedCount).toBe(10);
    expect(result.stats.candidateCount).toBe(100);
    expect(result.stats.cappedByLimit).toBe(true);
  });

  it("samples rather than taking the first N", () => {
    // The whole point of "magical". Taking the head would return the same pictures
    // from the same folder on every run and make the ceiling look like a bug.
    const candidates = photos(50);
    const result = selectPhotos(
      candidates,
      criteria({ maxPhotos: 5 }),
      cyclingRandom([0.9, 0.1, 0.7, 0.3, 0.5]),
    );
    const firstFive = candidates.slice(0, 5).map((photo) => photo.relativePath);
    expect(result.photos.map((photo) => photo.relativePath)).not.toEqual(firstFive);
  });

  it("returns each photograph at most once", () => {
    // A shuffle-and-slice must not duplicate; a bad swap index is how it would.
    const result = selectPhotos(
      photos(40),
      criteria({ maxPhotos: 40 }),
      cyclingRandom([0.1, 0.9, 0.4, 0.6]),
    );
    const paths = new Set(result.photos.map((photo) => photo.relativePath));
    expect(paths.size).toBe(40);
  });

  it("draws only from the candidates it was given", () => {
    const candidates = photos(10);
    const known = new Set(candidates.map((photo) => photo.relativePath));
    const result = selectPhotos(candidates, criteria({ maxPhotos: 4 }), cyclingRandom([0.2, 0.8]));
    for (const photo of result.photos) expect(known.has(photo.relativePath)).toBe(true);
  });

  it("handles an empty candidate set without throwing", () => {
    const result = selectPhotos([], criteria({ maxPhotos: 25 }), alwaysZero);
    expect(result.photos).toEqual([]);
    expect(result.stats.candidateCount).toBe(0);
    expect(result.stats.cappedByLimit).toBe(false);
  });

  it("treats a ceiling of zero as an empty draw rather than an error", () => {
    // The schema refuses this at the boundary; this is the belt-and-braces for a
    // caller that skipped validation, matching how an inverted range is handled.
    const result = selectPhotos(photos(10), criteria({ maxPhotos: 0 }), alwaysZero);
    expect(result.photos).toEqual([]);
    expect(result.stats.selectedCount).toBe(0);
  });

  it("carries the excluded-unknown-size count into the stats", () => {
    const result = selectPhotos(photos(3), criteria(), alwaysZero, {
      excludedUnknownSize: 7,
    });
    expect(result.stats.excludedUnknownSize).toBe(7);
  });

  it("reports zero exclusions when none were passed", () => {
    expect(selectPhotos(photos(3), criteria(), alwaysZero).stats.excludedUnknownSize).toBe(0);
  });
});

describe("describeGeneration", () => {
  it("explains an empty result", () => {
    const text = describeGeneration({
      candidateCount: 0,
      selectedCount: 0,
      maxPhotos: 50,
      cappedByLimit: false,
      excludedUnknownSize: 0,
    });
    expect(text).toContain("No photographs");
    expect(text).toContain("widening the dates");
  });

  it("names the unreadable-dimension cause when that is why nothing matched", () => {
    // The one exclusion a reader cannot see coming, so it has to be said out loud.
    const text = describeGeneration({
      candidateCount: 0,
      selectedCount: 0,
      maxPhotos: 50,
      cappedByLimit: false,
      excludedUnknownSize: 12,
    });
    expect(text).toContain("12 photographs");
    expect(text).toContain("no readable dimensions");
  });

  it("reads naturally for a single excluded photograph", () => {
    const text = describeGeneration({
      candidateCount: 0,
      selectedCount: 0,
      maxPhotos: 50,
      cappedByLimit: false,
      excludedUnknownSize: 1,
    });
    expect(text).toContain("1 photograph ");
    expect(text).toContain(" it");
  });

  it("reports a full draw plainly", () => {
    const text = describeGeneration({
      candidateCount: 8,
      selectedCount: 8,
      maxPhotos: 50,
      cappedByLimit: false,
      excludedUnknownSize: 0,
    });
    expect(text).toBe("Drew 8 of 8 matching photographs.");
  });

  it("says when the ceiling was what limited the result", () => {
    // The distinction that tells a reader whether raising the number would help or
    // whether they need to widen the dates.
    const text = describeGeneration({
      candidateCount: 900,
      selectedCount: 100,
      maxPhotos: 100,
      cappedByLimit: true,
      excludedUnknownSize: 0,
    });
    expect(text).toContain("Drew 100 of 900");
    expect(text).toContain("limited to 100");
  });

  it("mentions both the cap and the exclusions together", () => {
    const text = describeGeneration({
      candidateCount: 300,
      selectedCount: 50,
      maxPhotos: 50,
      cappedByLimit: true,
      excludedUnknownSize: 4,
    });
    expect(text).toContain("limited to 50");
    expect(text).toContain("4 in range excluded");
  });
});
