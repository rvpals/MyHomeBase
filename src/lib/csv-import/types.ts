export type ImportType = "Position" | "Transaction" | "Performance" | "Journal" | "Expense" | "Roster";

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
  /**
   * Ignore this column's cells and use this literal for every row instead — e.g.
   * mapping a column to Type and fixing the value at "ETF" when the export has no
   * column that says so. Blank or absent means "read the cells" as normal.
   */
  constantValue?: string;
}

/** CSV column index (as a string key) -> options for that column. */
export type FieldOptionsMap = Record<string, FieldOptions>;

/**
 * Which account a CSV's own account label refers to.
 *
 * Both halves are stored because each survives a different edit: the id holds
 * up when an account is renamed, and the name holds up when an account is
 * deleted and recreated (which gives it a new id). Resolving prefers the id and
 * falls back to the name — see `resolveAccountNameMapping`.
 */
export interface AccountNameMatch {
  accountId: number;
  /** The account's name at the time the match was saved. */
  accountName: string;
}

/**
 * A broker's account label as it appears in the CSV -> the account it means,
 * e.g. `"Fidelity HSA"` -> Fidelity Health Savings Account.
 *
 * Keyed by the raw cell text, trimmed. Matching is exact (case-insensitively);
 * for anything fuzzier, the Expense module's rules engine is the thing to copy
 * rather than growing a second matcher here.
 */
export type AccountNameMapping = Record<string, AccountNameMatch>;

export interface CsvPreview {
  headers: string[];
  totalRows: number;
  /** First few data rows, for a quick visual check before importing. */
  previewRows: string[][];
  /** Up to 10 rows chosen at random, to help a user recognize the column layout. */
  sampleRows: string[][];
  /**
   * Every data row, in file order. Needed by an importer that lets the user drop
   * individual rows before importing — you can't exclude a row you can't see.
   * Index here is the row's identity: it's what `excludedRowIndexes` refers to.
   */
  rows: string[][];
  autoMapping: ColumnMapping;
}

export interface NamedMapping {
  id: number;
  name: string;
  importType: ImportType;
  columnMapping: ColumnMapping;
  fieldOptions: FieldOptionsMap;
  /**
   * Account labels this broker's exports use. Empty for every import type but
   * Performance, and for mappings saved before this was recorded — the point of
   * keeping it is that "map once, reuse forever" should cover *which account a
   * row belongs to*, not only which column it came from.
   */
  accountNameMapping: AccountNameMapping;
  createdAt: string;
  updatedAt: string;
}

export interface ImportRowResult {
  rowNumber: number;
  /**
   * `updated` means the row matched an existing record and replaced it, rather
   * than inserting a second copy. Only the journal import produces it today —
   * every other importer emits `imported` or `skipped`, so their summaries
   * simply report `updatedCount: 0`.
   */
  status: "imported" | "updated" | "skipped";
  reason?: string;
}

export interface ImportSummary {
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  results: ImportRowResult[];
}
