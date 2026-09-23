// Reader-defined aggregate functions over a dataset's columns — "average of
// relative_humidity", "count of readings", "distinct rooms".
//
// Pure: rows in, numbers out. The whole vocabulary of what may be aggregated, and what
// each function means on what kind of column, lives here rather than in the chart
// screen — so the CLI computes identical figures and the rules are unit-testable
// without a browser.
//
// ## Why this is separate from source-stats.ts
//
// `computeSourceStats` answers a fixed question (every descriptive statistic, for the
// Compare screen's table) over ONE measure. These are reader-*composed*: an arbitrary
// list of (function, column) pairs, each independently chartable. The overlap in
// arithmetic is real but shallow — the shapes, the validation and the persistence are
// entirely different, and merging them would make one function serve two callers that
// want opposite things.

import type { CsvColumnDefinition } from "./types";

/**
 * The closed set of aggregate functions. Closed because each one's arithmetic lives
 * in `applyFunction` below and its column-type rule in `functionAcceptsColumn` — a
 * value outside this union has neither.
 */
export const CSV_AGGREGATE_FUNCTIONS = [
  "average",
  "min",
  "max",
  "sum",
  "count",
  "distinct",
] as const;

export type CsvAggregateFunction = (typeof CSV_AGGREGATE_FUNCTIONS)[number];

/** What the picker shows for each function. */
export const CSV_AGGREGATE_LABELS: Record<CsvAggregateFunction, string> = {
  average: "Average",
  min: "Minimum",
  max: "Maximum",
  sum: "Sum",
  count: "Count",
  distinct: "Distinct",
};

/**
 * Functions that need a numeric column. `count` and `distinct` are deliberately
 * absent: counting rows, or counting how many different rooms reported, is meaningful
 * on text too — and refusing it would make "how many devices are in this pool?"
 * unanswerable.
 */
const NUMERIC_ONLY: ReadonlySet<CsvAggregateFunction> = new Set([
  "average",
  "min",
  "max",
  "sum",
]);

const NUMERIC_COLUMN_TYPES: ReadonlySet<string> = new Set(["integer", "real", "boolean"]);

export function requiresNumericColumn(fn: CsvAggregateFunction): boolean {
  return NUMERIC_ONLY.has(fn);
}

/** Whether this function may be applied to this column. */
export function functionAcceptsColumn(
  fn: CsvAggregateFunction,
  column: CsvColumnDefinition,
): boolean {
  return requiresNumericColumn(fn) ? NUMERIC_COLUMN_TYPES.has(column.type) : true;
}

/** The columns a given function may be applied to, in the entry's own order. */
export function columnsForFunction(
  fn: CsvAggregateFunction,
  columns: CsvColumnDefinition[],
): CsvColumnDefinition[] {
  return columns.filter((column) => functionAcceptsColumn(fn, column));
}

/**
 * One aggregate as the reader defined it.
 *
 * `id` is client-generated and only has to be unique within one chart's list — it
 * exists so the UI can key rows and remove the right one when two aggregates are
 * otherwise identical ("average of humidity" twice, one charted and one not).
 */
export interface CsvAggregateDefinition {
  id: string;
  fn: CsvAggregateFunction;
  /** A name from the entry's columns[].name. */
  column: string;
  /** Whether to draw this as a reference line on the chart. */
  chartIt: boolean;
}

/** A computed aggregate: its definition, plus the value(s) it evaluated to. */
export interface CsvAggregateResult {
  id: string;
  fn: CsvAggregateFunction;
  column: string;
  chartIt: boolean;
  /** What the picker/legend calls this, e.g. "Average of Relative_Humidity". */
  label: string;
  /**
   * The value over every row considered. `null` when nothing could be computed —
   * no rows, or no non-null numeric values — which the UI shows as "—" rather than 0.
   */
  value: number | null;
  /**
   * One entry per source when the chart is split, else empty.
   *
   * Present so a split chart can draw Bathroom's average and Basement's average as
   * separate lines, matching what the reader is actually looking at.
   */
  bySource: { source: string; value: number | null }[];
  /** How many rows fed this figure (before null-filtering). */
  rowCount: number;
}

/** Coerces a stored cell to a finite number, or null. Mirrors source-stats.ts. */
function toNumber(value: string | number | null): number | null {
  if (value === null || value === undefined) return null;
  const numeric = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Applies one function to one column's raw cell values.
 *
 * `count` counts rows that have a value at all (non-null, non-blank) rather than every
 * row — "count of relative_humidity" meaning "how many readings did I actually get"
 * is the useful reading, and row-count is already on screen elsewhere.
 *
 * `distinct` counts distinct non-null values, compared as strings so that `40` and
 * `"40"` — which the same column can hold after a bulk edit — count once, not twice.
 */
export function applyFunction(fn: CsvAggregateFunction, cells: (string | number | null)[]): number | null {
  if (fn === "count") {
    return cells.filter((cell) => cell !== null && String(cell).trim() !== "").length;
  }

  if (fn === "distinct") {
    const seen = new Set<string>();
    cells.forEach((cell) => {
      if (cell === null) return;
      const text = String(cell).trim();
      if (text !== "") seen.add(text);
    });
    return seen.size;
  }

  const values = cells
    .map(toNumber)
    .filter((value): value is number => value !== null);
  if (values.length === 0) return null;

  switch (fn) {
    case "average":
      return values.reduce((total, value) => total + value, 0) / values.length;
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
    case "sum":
      return values.reduce((total, value) => total + value, 0);
  }
}

/** "Average of Relative_Humidity" — uses the display header, not the SQL name. */
export function describeAggregate(
  definition: { fn: CsvAggregateFunction; column: string },
  columns: CsvColumnDefinition[],
): string {
  const header =
    columns.find((column) => column.name === definition.column)?.sourceHeader ?? definition.column;
  return `${CSV_AGGREGATE_LABELS[definition.fn]} of ${header}`;
}

export interface ComputeAggregatesInput {
  columns: CsvColumnDefinition[];
  rows: (string | number | null)[][];
  definitions: CsvAggregateDefinition[];
  /**
   * When set, each aggregate is ALSO computed per distinct value of this column, so a
   * split chart can draw one reference line per source. Omit for a whole-table figure
   * only.
   */
  splitColumn?: string;
}

/**
 * Evaluates every definition against the rows.
 *
 * A definition naming a column that no longer exists is **skipped**, not thrown — the
 * same read-time forgiveness a custom view gives a dropped column, and for the same
 * reason: these are saved with a chart preset and the dataset can change underneath
 * them. A definition whose function doesn't suit its column's type is skipped too,
 * which can happen if a column was retyped after the aggregate was saved.
 *
 * Results keep the definitions' order, so the list on screen doesn't reshuffle when a
 * figure changes.
 */
export function computeAggregates(input: ComputeAggregatesInput): CsvAggregateResult[] {
  const { columns, rows, definitions, splitColumn } = input;

  const splitIndex =
    splitColumn === undefined || splitColumn === ""
      ? -1
      : columns.findIndex((column) => column.name === splitColumn);

  const results: CsvAggregateResult[] = [];

  definitions.forEach((definition) => {
    const columnIndex = columns.findIndex((column) => column.name === definition.column);
    if (columnIndex < 0) return;
    if (!functionAcceptsColumn(definition.fn, columns[columnIndex])) return;

    const cells = rows.map((row) => row[columnIndex] ?? null);

    const bySource: { source: string; value: number | null }[] = [];
    if (splitIndex >= 0) {
      // Insertion-ordered, so the lines appear in the order the sources first show up —
      // the same order `buildSplitChartData` assigns series colours in.
      const grouped = new Map<string, (string | number | null)[]>();
      rows.forEach((row) => {
        const raw = row[splitIndex];
        const key = raw === null ? "" : String(raw);
        const bucket = grouped.get(key) ?? [];
        bucket.push(row[columnIndex] ?? null);
        grouped.set(key, bucket);
      });
      grouped.forEach((bucket, source) => {
        bySource.push({ source, value: applyFunction(definition.fn, bucket) });
      });
    }

    results.push({
      id: definition.id,
      fn: definition.fn,
      column: definition.column,
      chartIt: definition.chartIt,
      label: describeAggregate(definition, columns),
      value: applyFunction(definition.fn, cells),
      bySource,
      rowCount: rows.length,
    });
  });

  return results;
}

/**
 * The reference lines a computed set of aggregates contributes to the chart.
 *
 * Only `chartIt` aggregates appear. When the chart is split, each aggregate yields one
 * line per source (so the benchmark matches the series it belongs to); unsplit, one
 * line. A null value draws nothing — there is no honest place to put it.
 */
export interface AggregateReferenceLine {
  /** Unique within the chart: `<definition id>` or `<definition id>::<source>`. */
  key: string;
  value: number;
  label: string;
  /**
   * Position in the emitted list, so the caller can give each line a distinct
   * colour.
   *
   * The *index* rather than a colour: this module is pure domain logic and must not
   * know a palette — `ARCHITECTURE.md` keeps presentation out of `lib/`. The chart
   * screen maps it onto whatever hues it uses.
   */
  index: number;
}

export function aggregateReferenceLines(
  results: CsvAggregateResult[],
): AggregateReferenceLine[] {
  const lines: AggregateReferenceLine[] = [];

  results.forEach((result) => {
    if (!result.chartIt) return;

    if (result.bySource.length > 0) {
      result.bySource.forEach((entry) => {
        if (entry.value === null) return;
        lines.push({
          key: `${result.id}::${entry.source}`,
          value: entry.value,
          label: `${result.label} — ${entry.source || "(none)"}`,
          index: lines.length,
        });
      });
      return;
    }

    if (result.value === null) return;
    lines.push({
      key: result.id,
      value: result.value,
      label: result.label,
      index: lines.length,
    });
  });

  return lines;
}
