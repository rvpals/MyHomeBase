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
