import { describe, expect, it } from "vitest";
import {
  aggregateReferenceLines,
  applyFunction,
  columnsForFunction,
  computeAggregates,
  describeAggregate,
  functionAcceptsColumn,
  requiresNumericColumn,
  type CsvAggregateDefinition,
} from "./aggregates";
import type { CsvColumnDefinition } from "./types";

const columns: CsvColumnDefinition[] = [
  { name: "timestamp", sourceHeader: "Timestamp", type: "datetime" },
  { name: "relative_humidity", sourceHeader: "Relative_Humidity", type: "real" },
  { name: "room", sourceHeader: "Room", type: "text" },
];

// Bathroom: 40, 50, 60. Basement: 70, 80.
const rows: (string | number | null)[][] = [
  ["2026-09-11 02:08:00", 40, "Bathroom"],
  ["2026-09-11 14:08:00", 50, "Bathroom"],
  ["2026-09-12 02:08:00", 60, "Bathroom"],
  ["2026-09-11 02:08:00", 70, "Basement"],
  ["2026-09-11 14:08:00", 80, "Basement"],
];

function define(
  fn: CsvAggregateDefinition["fn"],
  column: string,
  chartIt = false,
  id = `${fn}-${column}`,
): CsvAggregateDefinition {
  return { id, fn, column, chartIt };
}

describe("requiresNumericColumn / functionAcceptsColumn", () => {
  it("requires a numeric column for the arithmetic functions", () => {
    expect(requiresNumericColumn("average")).toBe(true);
    expect(requiresNumericColumn("min")).toBe(true);
    expect(requiresNumericColumn("max")).toBe(true);
    expect(requiresNumericColumn("sum")).toBe(true);
  });

  it("allows count and distinct on any column", () => {
    // "How many different rooms reported?" must stay answerable.
    expect(requiresNumericColumn("count")).toBe(false);
    expect(requiresNumericColumn("distinct")).toBe(false);
    expect(functionAcceptsColumn("distinct", columns[2])).toBe(true);
    expect(functionAcceptsColumn("count", columns[0])).toBe(true);
  });

  it("refuses average on a text column", () => {
    expect(functionAcceptsColumn("average", columns[2])).toBe(false);
  });

  it("accepts a boolean column as numeric", () => {
    const flag: CsvColumnDefinition = { name: "ok", sourceHeader: "Ok", type: "boolean" };
    expect(functionAcceptsColumn("average", flag)).toBe(true);
  });
});

describe("columnsForFunction", () => {
  it("offers only numeric columns for average", () => {
    expect(columnsForFunction("average", columns).map((c) => c.name)).toEqual([
      "relative_humidity",
    ]);
  });

  it("offers every column for distinct, in the entry's order", () => {
    expect(columnsForFunction("distinct", columns).map((c) => c.name)).toEqual([
      "timestamp",
      "relative_humidity",
      "room",
    ]);
  });
});

describe("applyFunction", () => {
  const cells = [40, 50, 60, 70, 80];

  it("averages", () => expect(applyFunction("average", cells)).toBe(60));
  it("takes the minimum", () => expect(applyFunction("min", cells)).toBe(40));
  it("takes the maximum", () => expect(applyFunction("max", cells)).toBe(80));
  it("sums", () => expect(applyFunction("sum", cells)).toBe(300));

  it("counts only cells that have a value", () => {
    expect(applyFunction("count", [40, null, 60, "", "  "])).toBe(2);
  });

  it("counts distinct values", () => {
    expect(applyFunction("distinct", ["Bathroom", "Basement", "Bathroom"])).toBe(2);
  });

  it("treats a number and its string form as one distinct value", () => {
    expect(applyFunction("distinct", [40, "40", 50])).toBe(2);
  });

  it("ignores nulls in the arithmetic rather than counting them as zero", () => {
    expect(applyFunction("average", [40, null, 60])).toBe(50);
  });

  it("parses numeric text", () => {
    expect(applyFunction("sum", ["40.5", 10])).toBe(50.5);
  });

  it("ignores an unparseable value", () => {
    expect(applyFunction("average", ["n/a", 40])).toBe(40);
  });

  it("returns null when nothing is numeric", () => {
    expect(applyFunction("average", ["n/a", null])).toBeNull();
    expect(applyFunction("min", [])).toBeNull();
  });

  it("returns zero, not null, for count and distinct over nothing", () => {
    // Zero is the true answer here, unlike an average of no values.
    expect(applyFunction("count", [])).toBe(0);
    expect(applyFunction("distinct", [])).toBe(0);
  });
});

describe("describeAggregate", () => {
  it("uses the column's display header", () => {
    expect(describeAggregate({ fn: "average", column: "relative_humidity" }, columns)).toBe(
      "Average of Relative_Humidity",
    );
  });

  it("falls back to the raw name for an unknown column", () => {
    expect(describeAggregate({ fn: "count", column: "gone" }, columns)).toBe("Count of gone");
  });
});

describe("computeAggregates", () => {
  it("evaluates each definition over every row", () => {
    const results = computeAggregates({
      columns,
      rows,
      definitions: [define("average", "relative_humidity"), define("max", "relative_humidity")],
    });
    expect(results.map((r) => r.value)).toEqual([60, 80]);
  });

  it("labels each result", () => {
    const [result] = computeAggregates({
      columns,
      rows,
      definitions: [define("average", "relative_humidity")],
    });
    expect(result.label).toBe("Average of Relative_Humidity");
    expect(result.rowCount).toBe(5);
  });

  it("keeps the definitions' order", () => {
    const results = computeAggregates({
      columns,
      rows,
      definitions: [define("max", "relative_humidity"), define("min", "relative_humidity")],
    });
    expect(results.map((r) => r.fn)).toEqual(["max", "min"]);
  });

  it("computes per source when splitting", () => {
    const [result] = computeAggregates({
      columns,
      rows,
      definitions: [define("average", "relative_humidity")],
      splitColumn: "room",
    });
    expect(result.bySource).toEqual([
      { source: "Bathroom", value: 50 },
      { source: "Basement", value: 75 },
    ]);
    // The whole-table figure is still there alongside the split.
    expect(result.value).toBe(60);
  });

  it("leaves bySource empty when not splitting", () => {
    const [result] = computeAggregates({
      columns,
      rows,
      definitions: [define("average", "relative_humidity")],
    });
    expect(result.bySource).toEqual([]);
  });

  it("skips a definition whose column was dropped", () => {
    // Saved with a preset, then the dataset changed — forgive rather than throw.
    const results = computeAggregates({
      columns,
      rows,
      definitions: [define("average", "gone"), define("max", "relative_humidity")],
    });
    expect(results).toHaveLength(1);
    expect(results[0].fn).toBe("max");
  });

  it("skips a definition whose function no longer suits the column's type", () => {
    const results = computeAggregates({
      columns,
      rows,
      definitions: [define("average", "room")],
    });
    expect(results).toEqual([]);
  });

  it("ignores an unknown split column rather than throwing", () => {
    const [result] = computeAggregates({
      columns,
      rows,
      definitions: [define("average", "relative_humidity")],
      splitColumn: "nope",
    });
    expect(result.bySource).toEqual([]);
    expect(result.value).toBe(60);
  });

  it("groups rows with no source value under an empty name", () => {
    const [result] = computeAggregates({
      columns,
      rows: [["2026-09-11 02:08:00", 40, null]],
      definitions: [define("average", "relative_humidity")],
      splitColumn: "room",
    });
    expect(result.bySource).toEqual([{ source: "", value: 40 }]);
  });

  it("returns nothing for no definitions", () => {
    expect(computeAggregates({ columns, rows, definitions: [] })).toEqual([]);
  });
});

describe("aggregateReferenceLines", () => {
  it("includes only the aggregates toggled to chart", () => {
    const results = computeAggregates({
      columns,
      rows,
      definitions: [
        define("average", "relative_humidity", true),
        define("max", "relative_humidity", false),
      ],
    });
    const lines = aggregateReferenceLines(results);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ value: 60, label: "Average of Relative_Humidity" });
  });

  it("draws one line per source when split", () => {
    const results = computeAggregates({
      columns,
      rows,
      definitions: [define("average", "relative_humidity", true)],
      splitColumn: "room",
    });
    const lines = aggregateReferenceLines(results);
    expect(lines.map((line) => line.value)).toEqual([50, 75]);
    expect(lines[0].label).toBe("Average of Relative_Humidity — Bathroom");
  });

  it("numbers the lines in emission order, for distinct colouring", () => {
    const results = computeAggregates({
      columns,
      rows,
      definitions: [define("average", "relative_humidity", true)],
      splitColumn: "room",
    });
    expect(aggregateReferenceLines(results).map((line) => line.index)).toEqual([0, 1]);
  });

  it("keeps numbering continuous across several aggregates", () => {
    const results = computeAggregates({
      columns,
      rows,
      definitions: [
        define("average", "relative_humidity", true, "a"),
        define("max", "relative_humidity", true, "b"),
      ],
    });
    expect(aggregateReferenceLines(results).map((line) => line.index)).toEqual([0, 1]);
  });

  it("does not number a skipped null line, leaving no colour gap", () => {
    const results = computeAggregates({
      columns,
      // Bathroom has a reading; Attic has none, so Attic contributes no line.
      rows: [
        ["2026-09-11 02:08:00", 40, "Bathroom"],
        ["2026-09-11 02:08:00", null, "Attic"],
      ],
      definitions: [define("average", "relative_humidity", true)],
      splitColumn: "room",
    });
    const lines = aggregateReferenceLines(results);
    expect(lines).toHaveLength(1);
    expect(lines[0].index).toBe(0);
  });

  it("gives every line a unique key", () => {
    const results = computeAggregates({
      columns,
      rows,
      definitions: [
        define("average", "relative_humidity", true, "a"),
        define("min", "relative_humidity", true, "b"),
      ],
      splitColumn: "room",
    });
    const keys = aggregateReferenceLines(results).map((line) => line.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("draws nothing for a null value", () => {
    const results = computeAggregates({
      columns,
      rows: [["2026-09-11 02:08:00", null, "Bathroom"]],
      definitions: [define("average", "relative_humidity", true)],
    });
    expect(aggregateReferenceLines(results)).toEqual([]);
  });

  it("labels an empty source readably", () => {
    const results = computeAggregates({
      columns,
      rows: [["2026-09-11 02:08:00", 40, null]],
      definitions: [define("average", "relative_humidity", true)],
      splitColumn: "room",
    });
    expect(aggregateReferenceLines(results)[0].label).toContain("(none)");
  });
});
