export type ImportType = "Position" | "Transaction" | "Performance" | "Journal" | "Expense";

/** CSV column index (as a string key) -> target field name. Columns absent from the map are ignored. */
export type ColumnMapping = Record<string, string>;

/**
 * Per-column interpretation options, carried alongside (not inside) ColumnMapping
 * so the stock importer's `Record<string,string>` mapping is untouched. Keyed by
 * the same CSV column index. Every option is optional — a column with no options
 * is interpreted with its field's defaults.
 */
export interface FieldOptions {
  /** For list-valued fields (categories, tags): how to split one cell into many
   *  values. A blank/whitespace delimiter means "split on runs of whitespace". */
  delimiter?: string;
  /** For date fields: the source date format, e.g. "M/D/YY" or "YYYY-MM-DD". */
  dateFormat?: string;
}

/** CSV column index (as a string key) -> options for that column. */
export type FieldOptionsMap = Record<string, FieldOptions>;

export interface CsvPreview {
  headers: string[];
  totalRows: number;
  /** First few data rows, for a quick visual check before importing. */
  previewRows: string[][];
  /** Up to 10 rows chosen at random, to help a user recognize the column layout. */
  sampleRows: string[][];
  autoMapping: ColumnMapping;
}

export interface NamedMapping {
  id: number;
  name: string;
  importType: ImportType;
  columnMapping: ColumnMapping;
  fieldOptions: FieldOptionsMap;
  createdAt: string;
  updatedAt: string;
}

export interface ImportRowResult {
  rowNumber: number;
  status: "imported" | "skipped";
  reason?: string;
}

export interface ImportSummary {
  importedCount: number;
  skippedCount: number;
  results: ImportRowResult[];
}
