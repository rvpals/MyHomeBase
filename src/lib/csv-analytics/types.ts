export type CsvColumnType = "text" | "integer" | "real" | "date" | "datetime" | "boolean";

export interface CsvColumnDefinition {
  /** Sanitized SQL identifier, e.g. "user_id". */
  name: string;
  /** Original CSV header text, kept for display. */
  sourceHeader: string;
  type: CsvColumnType;
}

export interface CsvAnalyticEntry {
  id: number;
  name: string;
  description?: string;
  /** Full physical table name, always "csv_" prefixed. */
  tableName: string;
  columns: CsvColumnDefinition[];
  /** Subset of columns[].name. Empty means the table uses a surrogate key. */
  primaryKeyFields: string[];
  /**
   * Which of `columns` record where a pooled row came from, rather than carrying a
   * measurement (migration 0104).
   *
   * Empty for every entry imported as a single file — including every entry that
   * existed before pooling — so "is this a pooled dataset" is exactly
   * `sourceColumns.length > 0`, with no migration of existing data needed.
   */
  sourceColumns: CsvSourceColumn[];
  /** Computed from the physical table on read — never stored. */
  rowCount: number;
  createdAt: string;
  updatedAt: string;
}

/** A read of an entry's physical table: its column defs (in order) plus row values as arrays. */
export interface CsvEntryData {
  columns: CsvColumnDefinition[];
  rows: (string | number | null)[][];
  /**
   * SQLite `rowid` per row, parallel to `rows` — `rowIds[i]` identifies `rows[i]`.
   *
   * A parallel array rather than a field on the row so `rows` keeps its exact shape:
   * every chart, export and cell lookup indexes by the column's position in `columns`,
   * and prepending a key would shift all of them.
   *
   * This is what makes a row writable. `rows` alone is anonymous values — the declared
   * columns are not necessarily unique, so position in the array is the only other
   * handle, and that is not stable across reads. Every physical table has a rowid
   * whichever shape `buildCreateTableSql` gave it: with no `primaryKeyFields` the
   * surrogate `_row_id INTEGER PRIMARY KEY AUTOINCREMENT` *is* the rowid, and a
   * composite-PK table still carries the implicit one.
   */
  rowIds: number[];
}

/** A named, saved set of chart-builder options for one entry. `optionsJson` is opaque to lib. */
export interface CsvChartPreset {
  id: number;
  entryId: number;
  name: string;
  optionsJson: string;
  createdAt: string;
  updatedAt: string;
}

export type IngestMode = "append" | "truncate" | "overwrite";

export interface IngestResult {
  inserted: number;
  skipped: number;
}

/**
 * A criterion's operator. Closed set — the SQL for each lives in view-query.ts,
 * and nothing outside this union ever reaches a query.
 */
export type CsvViewOperator =
  | "equals"
  | "notEquals"
  | "greaterThan"
  | "greaterThanOrEqual"
  | "lessThan"
  | "lessThanOrEqual"
  | "contains"
  | "notContains"
  | "startsWith"
  | "endsWith"
  | "between"
  | "isEmpty"
  | "isNotEmpty"
  | "in"
  | "notIn";

/** How many values an operator takes. Drives both validation and the builder UI. */
export type CsvViewOperatorArity = "none" | "one" | "two" | "list";

/** One filter condition. `values` length must match the operator's arity. */
export interface CsvViewCriterion {
  /** A name from the entry's columns[].name. */
  column: string;
  operator: CsvViewOperator;
  /** Raw text as typed; coerced per the column's type when the query is compiled. */
  values: string[];
}

export type CsvSortDirection = "asc" | "desc";

export interface CsvViewOrderBy {
  column: string;
  direction: CsvSortDirection;
}

/** A named, saved query over one entry's physical table. */
export interface CsvCustomView {
  id: number;
  entryId: number;
  name: string;
  description?: string;
  /** Empty means every column, resolved at read time — see migration 0081. */
  selectedColumns: string[];
  /** ANDed together. */
  criteria: CsvViewCriterion[];
  /** Applied in array order. */
  orderBy: CsvViewOrderBy[];
  recordsPerPage: number;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** One page of a view's results, plus what it took to know the page count. */
export interface CsvViewPage {
  columns: CsvColumnDefinition[];
  rows: (string | number | null)[][];
  /** Rows matching the view's criteria across every page, not just this one. */
  totalRows: number;
  /** 1-based. */
  page: number;
  pageCount: number;
  recordsPerPage: number;
}

/**
 * A column that records where a pooled row came from, rather than carrying a
 * measurement the CSV supplied.
 *
 * Two flavours, distinguished by `kind`:
 * - `file` — the source filename, filled in automatically per file. Exactly one
 *   per entry, always named `_source_file`.
 * - `label` — something the reader typed about that file ("Bathroom"). Up to
 *   `MAX_SOURCE_LABEL_COLUMNS` of them, named by the reader.
 *
 * These are ordinary columns in the entry's physical table, deliberately: every
 * existing feature (custom views, charts, bulk edit, grid export) then works on
 * them with no change. `source_columns_json` on the entry records which ones they
 * are, so Compare knows what it may group by and the importer knows what to
 * re-prompt for on the next file.
 */
export interface CsvSourceColumn {
  /** Matches one of the entry's columns[].name. */
  name: string;
  kind: "file" | "label";
  /** What the import screen prompts with, e.g. "Room". */
  label: string;
}

/** One file in a multi-file import, as the reader configured it before committing. */
export interface CsvImportFile {
  fileName: string;
  fileText: string;
  /** Value per source label column, keyed by that column's `name`. */
  labelValues: Record<string, string>;
}

/**
 * What a pooled import would do, computed before anything is written.
 *
 * `headerMismatches` being non-empty is a hard stop: the reader said these files
 * are the same kind of data, so a differing header is a wrong file rather than a
 * schema to merge. The plan is still returned so the screen can *show* the diff.
 */
export interface MultiFileImportPlan {
  /** Columns from the CSV itself, shared by every file. */
  dataColumns: CsvColumnDefinition[];
  /** The source/label columns appended after them. */
  sourceColumns: CsvSourceColumn[];
  /** Per file: what was parsed, and the row count it would contribute. */
  files: { fileName: string; rowCount: number; suggestedSourceName: string }[];
  totalRows: number;
  /** One entry per file whose headers differ from the first file's. Empty means importable. */
  headerMismatches: { fileName: string; reason: string }[];
}

/** Descriptive statistics for one numeric column over one group of rows. */
export interface SourceStats {
  /** The source value these rows share, e.g. "Bathroom". `null` is the combined row. */
  source: string | null;
  /** Rows in this group (including ones whose measure is null). */
  rowCount: number;
  /** Rows whose measure was null/unparseable — excluded from every figure below. */
  nullCount: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  median: number | null;
  /** Population standard deviation. `null` when fewer than 2 values. */
  stdDev: number | null;
}
