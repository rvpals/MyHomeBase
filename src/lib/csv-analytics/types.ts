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
