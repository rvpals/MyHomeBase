import { describe, expect, it } from "vitest";
import { describeScore, exposurePenalty, percentileRanks, scoreBatch } from "./score";
import type { AnalyzedPhoto, PhotoMetrics } from "./types";

/** Metrics with sensible middle values, overridden per test. */
function metrics(overrides: Partial<PhotoMetrics> = {}): PhotoMetrics {
  return {
    sharpness: 100,
    centerSharpness: 100,
    brightness: 128,
    contrast: 50,
    shadowClipping: 0,
    highlightClipping: 0,
    ...overrides,
  };
}

function photo(name: string, overrides: Partial<PhotoMetrics> = {}): AnalyzedPhoto {
  return {
    relativePath: `2019/2019-06/${name}`,
    name,
    metrics: metrics(overrides),
    hash: "0".repeat(16),
    width: 4000,
    height: 3000,
  };
}

describe("percentileRanks", () => {
  it("ranks ascending values from 0 to 1", () => {
    expect(percentileRanks([10, 20, 30])).toEqual([0, 0.5, 1]);
  });

  it("keeps ranks in the input's order, not sorted order", () => {
    expect(percentileRanks([30, 10, 20])).toEqual([1, 0, 0.5]);
  });

  it("gives tied values the average of the positions they span", () => {
    // Three 10s occupy positions 0,1,2 of 5 -> shared rank (0+2)/2 / 4 = 0.25.
    expect(percentileRanks([10, 10, 10, 20, 30])).toEqual([0.25, 0.25, 0.25, 0.75, 1]);
  });

  it("ranks a lone value in the middle, having nothing to compare it to", () => {
    expect(percentileRanks([42])).toEqual([0.5]);
  });

  it("returns an empty array for no values", () => {
    expect(percentileRanks([])).toEqual([]);
  });
});

describe("exposurePenalty", () => {
  it("is zero when clipping is within tolerance", () => {
    expect(exposurePenalty(metrics({ highlightClipping: 0.01 }))).toBe(0);
  });

  it("grows once clipping passes the tolerance", () => {
    const mild = exposurePenalty(metrics({ highlightClipping: 0.1 }));
    const severe = exposurePenalty(metrics({ highlightClipping: 0.6 }));
    expect(severe).toBeGreaterThan(mild);
    expect(mild).toBeGreaterThan(0);
  });

  it("adds shadow and highlight clipping, so a backlit frame is penalised for both", () => {
    const oneEnd = exposurePenalty(metrics({ highlightClipping: 0.3 }));
    const bothEnds = exposurePenalty(metrics({ highlightClipping: 0.3, shadowClipping: 0.3 }));
    expect(bothEnds).toBeGreaterThan(oneEnd);
  });

  it("never exceeds the configured maximum", () => {
    const worst = exposurePenalty(metrics({ highlightClipping: 1, shadowClipping: 1 }));
    expect(worst).toBeLessThanOrEqual(0.25);
  });
});

describe("scoreBatch", () => {
  it("ranks the sharp image above the blurred one", () => {
    const ranked = scoreBatch([
      photo("blurred.jpg", { sharpness: 5, centerSharpness: 5 }),
      photo("sharp.jpg", { sharpness: 900, centerSharpness: 900 }),
    ]);
    expect(ranked[0].name).toBe("sharp.jpg");
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it("returns images sorted best first", () => {
    const ranked = scoreBatch([
      photo("mid.jpg", { sharpness: 100, centerSharpness: 100 }),
      photo("worst.jpg", { sharpness: 1, centerSharpness: 1 }),
      photo("best.jpg", { sharpness: 900, centerSharpness: 900 }),
    ]);
    expect(ranked.map((entry) => entry.name)).toEqual(["best.jpg", "mid.jpg", "worst.jpg"]);
  });

  it("ranks a well-exposed frame above a blown one of equal sharpness", () => {
    const ranked = scoreBatch([
      photo("blown.jpg", { brightness: 253, highlightClipping: 0.5 }),
      photo("good.jpg", { brightness: 130 }),
    ]);
    expect(ranked[0].name).toBe("good.jpg");
  });

  it("ranks a well-exposed frame above an underexposed one", () => {
    const ranked = scoreBatch([
      photo("dark.jpg", { brightness: 4, shadowClipping: 0.6 }),
      photo("good.jpg", { brightness: 130 }),
    ]);
    expect(ranked[0].name).toBe("good.jpg");
  });

  it("does not call the brightest frame the best exposed", () => {
    // Exposure is ranked on distance from mid-grey, so 250 must lose to 128.
    const ranked = scoreBatch([
      photo("brightest.jpg", { brightness: 250 }),
      photo("midtone.jpg", { brightness: 128 }),
    ]);
    expect(ranked[0].name).toBe("midtone.jpg");
  });

  it("scores a single image without dividing by zero", () => {
    const ranked = scoreBatch([photo("only.jpg")]);
    expect(ranked).toHaveLength(1);
    expect(Number.isFinite(ranked[0].score)).toBe(true);
  });

  it("returns an empty array for an empty batch", () => {
    expect(scoreBatch([])).toEqual([]);
  });

  it("keeps every score within 0 and 1", () => {
    const ranked = scoreBatch([
      photo("a.jpg", { sharpness: 1, highlightClipping: 1, shadowClipping: 1 }),
      photo("b.jpg", { sharpness: 900 }),
    ]);
    for (const entry of ranked) {
      expect(entry.score).toBeGreaterThanOrEqual(0);
      expect(entry.score).toBeLessThanOrEqual(1);
    }
  });

  it("breaks ties on path so the order is stable", () => {
    const first = scoreBatch([photo("b.jpg"), photo("a.jpg")]);
    const second = scoreBatch([photo("a.jpg"), photo("b.jpg")]);
    expect(first.map((entry) => entry.name)).toEqual(second.map((entry) => entry.name));
  });
});

describe("describeScore", () => {
  it("names a sharp, well-exposed, low-contrast frame", () => {
    const reason = describeScore({ sharpness: 0.9, contrast: 0.1, exposure: 0.9 }, metrics());
    expect(reason).toBe("sharp, well exposed, low contrast");
  });

  it("calls a soft frame soft", () => {
    const reason = describeScore({ sharpness: 0.1, contrast: 0.5, exposure: 0.5 }, metrics());
    expect(reason).toContain("soft");
  });

  it("says overexposed rather than guessing from the rank", () => {
    const reason = describeScore(
      { sharpness: 0.9, contrast: 0.9, exposure: 0.9 },
      metrics({ highlightClipping: 0.5 }),
    );
    expect(reason).toContain("overexposed");
  });

  it("says underexposed when the shadows are crushed", () => {
    const reason = describeScore(
      { sharpness: 0.5, contrast: 0.5, exposure: 0.5 },
      metrics({ shadowClipping: 0.5 }),
    );
    expect(reason).toContain("underexposed");
  });
});
