import { describe, expect, it } from "vitest";
import {
  buildSourceSeries,
  buildSplitChartData,
  computeSourceStats,
  isMeasurableColumn,
  measurableColumns,
  seriesKey,
} from "./source-stats";
import type { CsvColumnDefinition } from "./types";

const columns: CsvColumnDefinition[] = [
  { name: "timestamp", sourceHeader: "Timestamp", type: "datetime" },
  { name: "relative_humidity", sourceHeader: "Relative_Humidity", type: "real" },
  { name: "room", sourceHeader: "Room", type: "text" },
];

// Bathroom: 40, 50, 60 -> mean 50. Basement: 70, 80 -> mean 75.
const rows: (string | number | null)[][] = [
  ["2026-09-11 02:08:00", 40, "Bathroom"],
  ["2026-09-11 14:08:00", 50, "Bathroom"],
  ["2026-09-12 02:08:00", 60, "Bathroom"],
  ["2026-09-11 02:08:00", 70, "Basement"],
  ["2026-09-11 14:08:00", 80, "Basement"],
];

function stats() {
  return computeSourceStats({
    columns,
    rows,
    groupColumn: "room",
    measureColumn: "relative_humidity",
  });
}

describe("isMeasurableColumn / measurableColumns", () => {
  it("accepts numeric column types only", () => {
    expect(isMeasurableColumn(columns[1])).toBe(true);
    expect(isMeasurableColumn(columns[0])).toBe(false);
    expect(isMeasurableColumn(columns[2])).toBe(false);
  });

  it("keeps the entry's column order", () => {
    expect(measurableColumns(columns).map((column) => column.name)).toEqual(["relative_humidity"]);
  });
});

describe("computeSourceStats", () => {
  it("summarises each source", () => {
    const bathroom = stats().perSource.find((group) => group.source === "Bathroom");
    expect(bathroom).toMatchObject({ rowCount: 3, nullCount: 0, min: 40, max: 60, mean: 50, median: 50 });
  });

  it("orders sources by mean, highest first", () => {
    expect(stats().perSource.map((group) => group.source)).toEqual(["Basement", "Bathroom"]);
  });

  it("names the highest and lowest source", () => {
    expect(stats().highest?.source).toBe("Basement");
    expect(stats().lowest?.source).toBe("Bathroom");
  });

  it("pools every row into the combined summary", () => {
    expect(stats().combined).toMatchObject({ source: null, rowCount: 5, min: 40, max: 80, mean: 60 });
  });

  it("averages the two middle values for an even count", () => {
    const basement = stats().perSource.find((group) => group.source === "Basement");
    expect(basement?.median).toBe(75);
  });

  it("computes a population standard deviation", () => {
    // Bathroom 40/50/60: variance = (100+0+100)/3 = 66.67, sd = 8.165
    const bathroom = stats().perSource.find((group) => group.source === "Bathroom");
    expect(bathroom?.stdDev).toBeCloseTo(8.165, 3);
  });

  it("returns null rather than zero for a single-reading group", () => {
    const single = computeSourceStats({
      columns,
      rows: [["2026-09-11 02:08:00", 40, "Attic"]],
      groupColumn: "room",
      measureColumn: "relative_humidity",
    });
    expect(single.perSource[0].stdDev).toBeNull();
    expect(single.perSource[0].mean).toBe(40);
  });

  it("excludes nulls from the figures but counts them", () => {
    const withNulls = computeSourceStats({
      columns,
      rows: [
        ["2026-09-11 02:08:00", 40, "Bathroom"],
        ["2026-09-11 14:08:00", null, "Bathroom"],
        ["2026-09-12 02:08:00", 60, "Bathroom"],
      ],
      groupColumn: "room",
      measureColumn: "relative_humidity",
    });
    // Mean is 50, not 33.3 — a null is not a zero.
    expect(withNulls.perSource[0]).toMatchObject({ rowCount: 3, nullCount: 1, mean: 50 });
  });

  it("reports nulls for a group with no usable readings", () => {
    const empty = computeSourceStats({
      columns,
      rows: [["2026-09-11 02:08:00", null, "Attic"]],
      groupColumn: "room",
      measureColumn: "relative_humidity",
    });
    expect(empty.perSource[0]).toMatchObject({ rowCount: 1, nullCount: 1, mean: null, min: null });
    expect(empty.highest).toBeUndefined();
  });

  it("sorts an unmeasurable group last rather than first", () => {
    const mixed = computeSourceStats({
      columns,
      rows: [
        ["2026-09-11 02:08:00", null, "Attic"],
        ["2026-09-11 02:08:00", 40, "Bathroom"],
      ],
      groupColumn: "room",
      measureColumn: "relative_humidity",
    });
    expect(mixed.perSource.map((group) => group.source)).toEqual(["Bathroom", "Attic"]);
  });

  it("parses a numeric value that arrived as text", () => {
    const asText = computeSourceStats({
      columns,
      rows: [["2026-09-11 02:08:00", "40.5", "Bathroom"]],
      groupColumn: "room",
      measureColumn: "relative_humidity",
    });
    expect(asText.perSource[0].mean).toBe(40.5);
  });

  it("treats an unparseable value as missing", () => {
    const junk = computeSourceStats({
      columns,
      rows: [
        ["2026-09-11 02:08:00", "n/a", "Bathroom"],
        ["2026-09-11 14:08:00", 40, "Bathroom"],
      ],
      groupColumn: "room",
      measureColumn: "relative_humidity",
    });
    expect(junk.perSource[0]).toMatchObject({ nullCount: 1, mean: 40 });
  });

  it("groups a row with no source value rather than dropping it", () => {
    const missing = computeSourceStats({
      columns,
      rows: [["2026-09-11 02:08:00", 40, null]],
      groupColumn: "room",
      measureColumn: "relative_humidity",
    });
    expect(missing.perSource[0].source).toBe("");
    expect(missing.combined.rowCount).toBe(1);
  });

  it("throws on an unknown group column", () => {
    expect(() =>
      computeSourceStats({ columns, rows, groupColumn: "nope", measureColumn: "relative_humidity" }),
    ).toThrow(/Unknown group column/);
  });

  it("throws on an unknown measure column", () => {
    expect(() =>
      computeSourceStats({ columns, rows, groupColumn: "room", measureColumn: "nope" }),
    ).toThrow(/Unknown measure column/);
  });

  it("returns an empty result for no rows", () => {
    const none = computeSourceStats({
      columns,
      rows: [],
      groupColumn: "room",
      measureColumn: "relative_humidity",
    });
    expect(none.perSource).toEqual([]);
    expect(none.combined.mean).toBeNull();
    expect(none.highest).toBeUndefined();
  });
});

describe("buildSourceSeries", () => {
  it("splits the rows into one series per source", () => {
    const series = buildSourceSeries({
      columns,
      rows,
      groupColumn: "room",
      xColumn: "timestamp",
      measureColumn: "relative_humidity",
    });
    expect(series.map((one) => one.source)).toEqual(["Bathroom", "Basement"]);
    expect(series[0].points).toHaveLength(3);
    expect(series[0].points[0]).toEqual({ x: "2026-09-11 02:08:00", y: 40 });
  });

  it("keeps a null measurement as a gap rather than dropping the point", () => {
    const series = buildSourceSeries({
      columns,
      rows: [["2026-09-11 02:08:00", null, "Bathroom"]],
      groupColumn: "room",
      xColumn: "timestamp",
      measureColumn: "relative_humidity",
    });
    expect(series[0].points).toEqual([{ x: "2026-09-11 02:08:00", y: null }]);
  });

  it("throws on an unknown x column", () => {
    expect(() =>
      buildSourceSeries({
        columns,
        rows,
        groupColumn: "room",
        xColumn: "nope",
        measureColumn: "relative_humidity",
      }),
    ).toThrow(/Unknown x column/);
  });
});


describe("buildSplitChartData", () => {
  function split(measureColumns = ["relative_humidity"]) {
    return buildSplitChartData({
      columns,
      rows,
      xColumn: "timestamp",
      splitColumn: "room",
      measureColumns,
    });
  }

  it("makes one series per source", () => {
    expect(split().series.map((one) => one.source)).toEqual(["Bathroom", "Basement"]);
  });

  it("labels a single-measure series with just the source", () => {
    // The y axis already says what is being measured, so repeating it is noise.
    expect(split().series.map((one) => one.label)).toEqual(["Bathroom", "Basement"]);
  });

  it("shares one record between sources reporting the same x", () => {
    const result = split();
    // Two rooms both report at 2026-09-11 02:08 and 14:08, so 5 rows -> 3 x values.
    expect(result.rows).toHaveLength(3);
    const first = result.rows[0];
    expect(first[seriesKey("relative_humidity", "Bathroom")]).toBe(40);
    expect(first[seriesKey("relative_humidity", "Basement")]).toBe(70);
  });

  it("keeps the x value under the x column's own key", () => {
    expect(split().rows[0].timestamp).toBe("2026-09-11 02:08:00");
  });

  it("leaves a source absent at an x rather than writing a zero", () => {
    // Bathroom alone reports at 2026-09-12; Basement must not appear as 0 there.
    const third = split().rows[2];
    expect(third[seriesKey("relative_humidity", "Bathroom")]).toBe(60);
    expect(third[seriesKey("relative_humidity", "Basement")]).toBeUndefined();
  });

  it("prefixes the measure when several are plotted", () => {
    const multi = buildSplitChartData({
      columns: [...columns, { name: "temp_f", sourceHeader: "Temp_F", type: "real" }],
      rows: rows.map((row) => [...row, 70]),
      xColumn: "timestamp",
      splitColumn: "room",
      measureColumns: ["relative_humidity", "temp_f"],
    });
    expect(multi.series).toHaveLength(4);
    expect(multi.series[0].label).toBe("Relative_Humidity — Bathroom");
    expect(multi.series[3].label).toBe("Temp_F — Basement");
  });

  it("orders series by measure, then by first appearance of the source", () => {
    expect(split().series.map((one) => one.key)).toEqual([
      seriesKey("relative_humidity", "Bathroom"),
      seriesKey("relative_humidity", "Basement"),
    ]);
  });

  it("carries a null measurement through as a gap", () => {
    const withNull = buildSplitChartData({
      columns,
      rows: [["2026-09-11 02:08:00", null, "Bathroom"]],
      xColumn: "timestamp",
      splitColumn: "room",
      measureColumns: ["relative_humidity"],
    });
    expect(withNull.rows[0][seriesKey("relative_humidity", "Bathroom")]).toBeNull();
  });

  it("groups a row with no source under an empty name", () => {
    const missing = buildSplitChartData({
      columns,
      rows: [["2026-09-11 02:08:00", 40, null]],
      xColumn: "timestamp",
      splitColumn: "room",
      measureColumns: ["relative_humidity"],
    });
    expect(missing.series[0].source).toBe("");
    expect(missing.series[0].label).toBe("(none)");
  });

  it("throws on an unknown split column", () => {
    expect(() =>
      buildSplitChartData({
        columns,
        rows,
        xColumn: "timestamp",
        splitColumn: "nope",
        measureColumns: ["relative_humidity"],
      }),
    ).toThrow(/Unknown split column/);
  });

  it("throws on an unknown measure column", () => {
    expect(() =>
      buildSplitChartData({
        columns,
        rows,
        xColumn: "timestamp",
        splitColumn: "room",
        measureColumns: ["nope"],
      }),
    ).toThrow(/Unknown measure column/);
  });

  it("returns nothing for no rows", () => {
    const none = buildSplitChartData({
      columns,
      rows: [],
      xColumn: "timestamp",
      splitColumn: "room",
      measureColumns: ["relative_humidity"],
    });
    expect(none.rows).toEqual([]);
    expect(none.series).toEqual([]);
  });
});
