import { describe, expect, it } from "vitest";
import {
  COMPACT_MAX_POINT_LABELS,
  DEFAULT_MAX_POINT_LABELS,
  isPointLabelModeCapped,
  parseChartDisplay,
  resolvePointLabelMode,
  selectLabeledIndexes,
  serializeChartDisplay,
  type ChartDisplay,
} from "./chart-options";

const FALLBACK: ChartDisplay = {
  pointLabels: "none",
  showDots: true,
  showLegend: false,
  showGrid: true,
};

describe("selectLabeledIndexes", () => {
  const values = [10, 4, 25, 12];

  it("labels nothing in 'none'", () => {
    expect(selectLabeledIndexes(values, "none")).toEqual([]);
  });

  it("labels every point in 'all'", () => {
    expect(selectLabeledIndexes(values, "all")).toEqual([0, 1, 2, 3]);
  });

  it("labels the last point in 'last'", () => {
    expect(selectLabeledIndexes(values, "last")).toEqual([3]);
  });

  it("labels the low and the high in 'extremes', ascending", () => {
    expect(selectLabeledIndexes(values, "extremes")).toEqual([1, 2]);
  });

  it("returns one index when a flat series has the same low and high", () => {
    expect(selectLabeledIndexes([7, 7, 7], "extremes")).toEqual([0]);
  });

  it("returns nothing for an empty series", () => {
    expect(selectLabeledIndexes([], "all")).toEqual([]);
    expect(selectLabeledIndexes([], "last")).toEqual([]);
  });

  it("skips gaps rather than reading them as zero", () => {
    // A sparse series: null is "not recorded", not a balance of nothing. Were the
    // nulls treated as 0 the low would be index 1 and 'last' would land on 3.
    const sparse = [10, null, 25, undefined, 12];
    expect(selectLabeledIndexes(sparse, "all")).toEqual([0, 2, 4]);
    expect(selectLabeledIndexes(sparse, "last")).toEqual([4]);
    expect(selectLabeledIndexes(sparse, "extremes")).toEqual([0, 2]);
  });

  it("ignores values that aren't numbers", () => {
    expect(selectLabeledIndexes([1, Number.NaN, "n/a", "3"], "all")).toEqual([0, 3]);
  });

  it("returns nothing when every value is a gap", () => {
    expect(selectLabeledIndexes([null, undefined], "extremes")).toEqual([]);
  });

  it("downgrades 'all' to the extremes past the cap", () => {
    const dense = Array.from({ length: DEFAULT_MAX_POINT_LABELS + 1 }, (_, index) => index);
    expect(selectLabeledIndexes(dense, "all")).toEqual([0, DEFAULT_MAX_POINT_LABELS]);
  });

  it("honours 'all' exactly at the cap", () => {
    const atCap = Array.from({ length: DEFAULT_MAX_POINT_LABELS }, (_, index) => index);
    expect(selectLabeledIndexes(atCap, "all")).toHaveLength(DEFAULT_MAX_POINT_LABELS);
  });

  it("counts present points, not rows, against the cap", () => {
    // 20 rows but only 3 readings — "every point" is still perfectly readable.
    const sparse: (number | null)[] = Array.from({ length: 20 }, () => null);
    sparse[2] = 5;
    sparse[9] = 8;
    sparse[19] = 6;
    expect(selectLabeledIndexes(sparse, "all", 4)).toEqual([2, 9, 19]);
  });

  it("applies a caller-supplied cap", () => {
    expect(selectLabeledIndexes([1, 2, 3, 4], "all", 3)).toEqual([0, 3]);
  });

  it("downgrades a six-point series under the compact cap", () => {
    // The measured phone case: six labels across 390px collide, so a narrow
    // viewport shows the high and low instead.
    const sixPoints = [40.33, 44.1, 38.02, 51.75, 47.4, 62.18];
    expect(selectLabeledIndexes(sixPoints, "all", COMPACT_MAX_POINT_LABELS)).toEqual([2, 5]);
    expect(selectLabeledIndexes(sixPoints, "all", DEFAULT_MAX_POINT_LABELS)).toHaveLength(6);
  });
});

describe("resolvePointLabelMode", () => {
  it("passes through every mode but 'all'", () => {
    expect(resolvePointLabelMode("none", 500)).toBe("none");
    expect(resolvePointLabelMode("last", 500)).toBe("last");
    expect(resolvePointLabelMode("extremes", 500)).toBe("extremes");
  });

  it("caps 'all' on a dense series", () => {
    expect(resolvePointLabelMode("all", 5)).toBe("all");
    expect(resolvePointLabelMode("all", 500)).toBe("extremes");
  });

  it("reports whether the reader's choice was overridden", () => {
    expect(isPointLabelModeCapped("all", 5)).toBe(false);
    expect(isPointLabelModeCapped("all", 500)).toBe(true);
    expect(isPointLabelModeCapped("extremes", 500)).toBe(false);
  });
});

describe("parseChartDisplay", () => {
  it("round-trips a serialized state", () => {
    const display: ChartDisplay = {
      pointLabels: "extremes",
      showDots: false,
      showLegend: true,
      showGrid: false,
    };
    expect(parseChartDisplay(serializeChartDisplay(display), FALLBACK)).toEqual(display);
  });

  it("falls back on nothing stored", () => {
    expect(parseChartDisplay(null, FALLBACK)).toEqual(FALLBACK);
    expect(parseChartDisplay("", FALLBACK)).toEqual(FALLBACK);
    expect(parseChartDisplay(undefined, FALLBACK)).toEqual(FALLBACK);
  });

  it("falls back on malformed JSON", () => {
    expect(parseChartDisplay("{not json", FALLBACK)).toEqual(FALLBACK);
  });

  it("falls back on JSON that isn't an object", () => {
    expect(parseChartDisplay("42", FALLBACK)).toEqual(FALLBACK);
    expect(parseChartDisplay("null", FALLBACK)).toEqual(FALLBACK);
  });

  it("keeps the fields it recognises and falls back per field", () => {
    // A stored shape from before a field existed must not discard the rest.
    expect(parseChartDisplay('{"pointLabels":"last"}', FALLBACK)).toEqual({
      ...FALLBACK,
      pointLabels: "last",
    });
  });

  it("rejects an unknown label mode", () => {
    expect(parseChartDisplay('{"pointLabels":"every-other"}', FALLBACK).pointLabels).toBe(
      FALLBACK.pointLabels,
    );
  });

  it("rejects non-boolean toggles", () => {
    expect(parseChartDisplay('{"showDots":"yes","showGrid":1}', FALLBACK)).toEqual(FALLBACK);
  });
});
