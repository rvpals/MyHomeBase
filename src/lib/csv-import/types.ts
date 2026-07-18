export type ImportType = "Position" | "Transaction" | "Performance";

/** CSV column index (as a string key) -> target field name. Columns absent from the map are ignored. */
export type ColumnMapping = Record<string, string>;

export interface CsvPreview {
  headers: string[];
  totalRows: number;
  /** First few data rows, for a quick visual check before importing. */
  previewRows: string[][];
  autoMapping: ColumnMapping;
}

export interface NamedMapping {
  id: number;
  name: string;
  importType: ImportType;
  columnMapping: ColumnMapping;
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
