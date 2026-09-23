// Descriptive statistics for a pooled dataset, grouped by source.
//
// Pure — rows in, numbers out. This is what answers "combine all the humidity devices:
// what's the average, which one is highest, what's the trend" without a database: the
// caller has already read the rows (the Compare screen reads them the same way the
// chart does), and every figure here is arithmetic over that array.
//
// ## Nulls are excluded, and counted
//
// A null measurement is not a zero. Averaging it as zero would drag a device's mean
// toward nothing, so every figure below is computed over the non-null values only and
// `nullCount` reports how many were left out. A group with no usable values reports
// `null` for every figure rather than `NaN` or `0`, so the UI can say "no data" instead
// of printing a fake number.
//
// ## Population, not sample, standard deviation
//
// These readings are the whole record of what the device reported, not a sample drawn
// from a larger population, so dividing by n is the honest choice. It also keeps
// `stdDev` defined for n = 1 groups... except that a standard deviation of 0 from a
// single reading reads as "perfectly stable", which is misleading, so n < 2 returns
// null instead.

import type { CsvColumnDefinition, SourceStats } from "./types";

/** Numeric column types — the only ones a statistic can be computed over. */
const NUMERIC_TYPES = new Set(["integer", "real", "boolean"]);

/** Whether this column can be used as a measure on the Compare screen. */
export function isMeasurableColumn(column: CsvColumnDefinition): boolean {
  return NUMERIC_TYPES.has(column.type);
}

/** The columns Compare offers as a measure, in the entry's own column order. */
export function measurableColumns(columns: CsvColumnDefinition[]): CsvColumnDefinition[] {
  return columns.filter(isMeasurableColumn);
}

/**
 * Coerces a stored cell to a finite number, or null.
 *
 * SQLite hands back a real `number` for INTEGER/REAL columns, but a value that arrived
 * through a TEXT column (or a bulk edit) can still be a numeric string, so both are
 * accepted. Anything else — including NaN and Infinity — is "no reading".
 */
function toNumber(value: string | number | null): number | null {
  if (value === null) return null;
  const numeric = typeof value === "number" ? value : Number(value.trim());
  return Number.isFinite(numeric) ? numeric : null;
}

/** min/max/mean/median/sd over already-extracted values. `values` is not mutated. */
function summarize(source: string | null, values: number[], rowCount: number): SourceStats {
  const nullCount = rowCount - values.length;
  if (values.length === 0) {
    return { source, rowCount, nullCount, min: null, max: null, mean: null, median: null, stdDev: null };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];

  const stdDev =
    values.length < 2
      ? null
      : Math.sqrt(
          values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length,
        );

  return {
    source,
    rowCount,
    nullCount,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean,
    median,
    stdDev,
  };
}

export interface SourceStatsInput {
  columns: CsvColumnDefinition[];
  rows: (string | number | null)[][];
  /** The column whose values name each group, e.g. `_source_file` or `room`. */
  groupColumn: string;
  /** The numeric column being summarised, e.g. `relative_humidity`. */
  measureColumn: string;
}

export interface SourceStatsResult {
  /** One row per distinct source value, sorted by descending mean (highest first). */
  perSource: SourceStats[];
  /** Every row pooled, with `source: null`. */
  combined: SourceStats;
  /** The source with the highest mean, or undefined when nothing is measurable. */
  highest?: SourceStats;
  /** The source with the lowest mean, or undefined when nothing is measurable. */
  lowest?: SourceStats;
}

/**
 * Groups rows by `groupColumn` and summarises `measureColumn` within each group, plus
 * one combined summary over everything.
 *
 * Throws when either column is not in `columns` — unlike a custom view's read-time
 * forgiveness, a statistic over a column that isn't there has no sensible degraded
 * answer, and silently returning zeros would be a lie. The Compare screen picks both
 * names from the entry's own column list, so a throw means a caller bug.
 *
 * Groups are ordered by mean, descending, so "which one is highest" is the first row.
 * A group whose mean is null (no usable readings) sorts last rather than first.
 */
export function computeSourceStats(input: SourceStatsInput): SourceStatsResult {
  const { columns, rows, groupColumn, measureColumn } = input;

  const groupIndex = columns.findIndex((column) => column.name === groupColumn);
  if (groupIndex < 0) throw new Error(`Unknown group column "${groupColumn}".`);

  const measureIndex = columns.findIndex((column) => column.name === measureColumn);
  if (measureIndex < 0) throw new Error(`Unknown measure column "${measureColumn}".`);

  // Insertion-ordered so an all-null-mean result still comes back in a stable order.
  const groups = new Map<string, { values: number[]; rowCount: number }>();
  const allValues: number[] = [];

  rows.forEach((row) => {
    const rawGroup = row[groupIndex];
    // A row with no source value is still a row; it groups under "" rather than
    // vanishing, so the counts add up to the combined total.
    const key = rawGroup === null ? "" : String(rawGroup);
    const group = groups.get(key) ?? { values: [], rowCount: 0 };
    group.rowCount += 1;

    const value = toNumber(row[measureIndex]);
    if (value !== null) {
      group.values.push(value);
      allValues.push(value);
    }
    groups.set(key, group);
  });

  const perSource = [...groups.entries()]
    .map(([key, group]) => summarize(key, group.values, group.rowCount))
    .sort((a, b) => {
      if (a.mean === null && b.mean === null) return 0;
      if (a.mean === null) return 1;
      if (b.mean === null) return -1;
      return b.mean - a.mean;
    });

  const ranked = perSource.filter((stats) => stats.mean !== null);

  return {
    perSource,
    combined: summarize(null, allValues, rows.length),
    highest: ranked[0],
    lowest: ranked[ranked.length - 1],
  };
}

/** One point of one source's series, ready for a chart. */
export interface SourceSeriesPoint {
  x: string | number | null;
  y: number | null;
}

export interface SourceSeries {
  source: string;
  points: SourceSeriesPoint[];
}

/**
 * Splits a pooled table into one series per source, for overlaying on a single chart.
 *
 * Points keep the order the rows arrived in — the caller decides whether to sort by x,
 * because a pooled read is ordered by insertion (so: by file), which is exactly the
 * order a per-source series wants anyway.
 */
export function buildSourceSeries(input: {
  columns: CsvColumnDefinition[];
  rows: (string | number | null)[][];
  groupColumn: string;
  xColumn: string;
  measureColumn: string;
}): SourceSeries[] {
  const { columns, rows, groupColumn, xColumn, measureColumn } = input;

  const groupIndex = columns.findIndex((column) => column.name === groupColumn);
  if (groupIndex < 0) throw new Error(`Unknown group column "${groupColumn}".`);
  const xIndex = columns.findIndex((column) => column.name === xColumn);
  if (xIndex < 0) throw new Error(`Unknown x column "${xColumn}".`);
  const measureIndex = columns.findIndex((column) => column.name === measureColumn);
  if (measureIndex < 0) throw new Error(`Unknown measure column "${measureColumn}".`);

  const series = new Map<string, SourceSeriesPoint[]>();
  rows.forEach((row) => {
    const rawGroup = row[groupIndex];
    const key = rawGroup === null ? "" : String(rawGroup);
    const points = series.get(key) ?? [];
    points.push({ x: row[xIndex], y: toNumber(row[measureIndex]) });
    series.set(key, points);
  });

  return [...series.entries()].map(([source, points]) => ({ source, points }));
}

/** One series in a split chart: the field key chart rows carry, and its display label. */
export interface SplitSeries {
  /** The key in each chart record, e.g. "relative_humidity::Bathroom". */
  key: string;
  /** What the legend shows, e.g. "Relative_Humidity — Bathroom". */
  label: string;
  /** The source value this series belongs to. */
  source: string;
  /** The measure column this series plots. */
  measureColumn: string;
}

export interface SplitChartData {
  /** One record per distinct x value, carrying a field per series. */
  rows: Record<string, number | string | null>[];
  series: SplitSeries[];
}

/**
 * Pivots a pooled table so each source becomes its own chart series.
 *
 * Without this, plotting a pooled dataset draws every device's readings as ONE line —
 * Bathroom's 45% and Basement's 71% alternating row by row, which reads as violent
 * oscillation rather than two steady rooms. Splitting is what makes a pooled dataset
 * chartable at all.
 *
 * Rows are keyed by their x value, so two sources reporting the same timestamp share a
 * record and the chart draws them at the same point on the axis. A source missing that
 * x simply has no field there, which Recharts renders as a gap rather than a zero.
 *
 * With several measures AND several sources the series multiply (measure × source), so
 * the caller is expected to cap what it offers — the chart builder allows one measure
 * when splitting, which keeps the legend readable.
 *
 * Series order is deterministic: measure order first (as passed), then sources in
 * first-appearance order, so the same data always colours the same way.
 */
export function buildSplitChartData(input: {
  columns: CsvColumnDefinition[];
  rows: (string | number | null)[][];
  xColumn: string;
  /** The column whose values name each series, e.g. `_source_file` or `room`. */
  splitColumn: string;
  /** The numeric column(s) to plot. */
  measureColumns: string[];
}): SplitChartData {
  const { columns, rows, xColumn, splitColumn, measureColumns } = input;

  const xIndex = columns.findIndex((column) => column.name === xColumn);
  if (xIndex < 0) throw new Error(`Unknown x column "${xColumn}".`);
  const splitIndex = columns.findIndex((column) => column.name === splitColumn);
  if (splitIndex < 0) throw new Error(`Unknown split column "${splitColumn}".`);

  const measureIndexes = measureColumns.map((name) => {
    const index = columns.findIndex((column) => column.name === name);
    if (index < 0) throw new Error(`Unknown measure column "${name}".`);
    return index;
  });

  // Insertion-ordered, so the x axis keeps the order the rows were read in and the
  // series keep first-appearance order.
  const byX = new Map<string, Record<string, number | string | null>>();
  const sources: string[] = [];
  const seenSources = new Set<string>();

  rows.forEach((row) => {
    const source = row[splitIndex] === null ? "" : String(row[splitIndex]);
    if (!seenSources.has(source)) {
      seenSources.add(source);
      sources.push(source);
    }

    const xValue = row[xIndex];
    const xKey = String(xValue ?? "");
    const record = byX.get(xKey) ?? { [xColumn]: xValue };

    measureColumns.forEach((measure, i) => {
      record[seriesKey(measure, source)] = toNumber(row[measureIndexes[i]]);
    });
    byX.set(xKey, record);
  });

  const series: SplitSeries[] = [];
  measureColumns.forEach((measure) => {
    const header =
      columns.find((column) => column.name === measure)?.sourceHeader ?? measure;
    sources.forEach((source) => {
      series.push({
        key: seriesKey(measure, source),
        // With one measure the measure name is redundant — the y axis already says it.
        label: measureColumns.length === 1 ? source || "(none)" : `${header} — ${source || "(none)"}`,
        source,
        measureColumn: measure,
      });
    });
  });

  return { rows: [...byX.values()], series };
}

/**
 * The field name one (measure, source) pair occupies in a chart record.
 *
 * "::" because a column name is `[a-z0-9_]` (slugified) and a source value is free
 * text, so the pair can't be ambiguous — and a source containing "::" still can't
 * collide with a different measure, since the measure half is matched first.
 */
export function seriesKey(measureColumn: string, source: string): string {
  return `${measureColumn}::${source}`;
}
