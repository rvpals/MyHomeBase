import type {
  CreateCsvAnalyticEntryInput,
  CreateCsvCustomViewInput,
  SaveChartPresetInput,
  UpdateCsvCustomViewInput,
} from "./schema";
import type {
  CsvAnalyticEntry,
  CsvChartPreset,
  CsvColumnDefinition,
  CsvCustomView,
  CsvEntryData,
  CsvSourceColumn,
  CsvViewPage,
  IngestResult,
} from "./types";

// The use-cases depend on THIS interface, not on a concrete database.
export interface CsvAnalyticsRepository {
  listEntries(): CsvAnalyticEntry[];
  getEntryById(id: number): CsvAnalyticEntry | undefined;
  isTableNameTaken(tableName: string, excludingId?: number): boolean;
  /** Reads the entry's physical table: column defs (in order) + row values as arrays. Optionally capped. */
  readTableData(id: number, limit?: number): CsvEntryData;
  /**
   * Creates the metadata row, creates the physical table, inserts every row. One
   * transaction. `rows` is already parsed from `input.fileText` by the use-case layer —
   * the repository never parses CSV text itself.
   */
  createEntry(input: CreateCsvAnalyticEntryInput, rows: string[][]): CsvAnalyticEntry;
  /** INSERT OR IGNORE each row into the entry's existing table — schema unchanged. */
  appendRows(id: number, rows: string[][]): IngestResult;
  /** Clears the entry's existing table, then inserts — schema unchanged. */
  truncateAndReload(id: number, rows: string[][]): IngestResult;
  /**
   * ALTER TABLEs in one new column per definition and updates columns_json to match.
   * Existing rows get SQLite's default NULL for each new column — no backfill.
   */
  addColumns(id: number, newColumns: CsvColumnDefinition[]): CsvAnalyticEntry;
  /** Drops the entry's old physical table, creates a new one from `input`, loads its rows. */
  overwriteEntry(id: number, input: CreateCsvAnalyticEntryInput, rows: string[][]): CsvAnalyticEntry;
  /**
   * Applies `values` to `fields` on every rowid in `chunks`, as ONE transaction.
   *
   * The use case pre-chunks the selection (SQLite's host-parameter ceiling) and has
   * already validated the field names against the entry's columns and coerced every
   * value — the repository only builds the UPDATE and binds. Returns rows changed
   * across every chunk.
   */
  bulkUpdateRows(
    entryId: number,
    chunks: number[][],
    fields: string[],
    values: Record<string, string | number | null>,
  ): number;
  /**
   * Creates a pooled entry from several files in ONE transaction: metadata row,
   * physical table (data columns + source columns), and every file's tagged rows.
   *
   * All-or-nothing on purpose — a half-imported pool is worse than none, because the
   * per-source statistics it feeds would silently be computed over a subset.
   *
   * `rows` is already parsed, widened and tagged by the use-case (`buildPooledRows`);
   * the repository never parses CSV text, same rule as `createEntry`.
   */
  createPooledEntry(
    input: { name: string; description?: string; tableBaseName: string },
    columns: CsvColumnDefinition[],
    sourceColumns: CsvSourceColumn[],
    rows: string[][],
  ): CsvAnalyticEntry;

  /**
   * Appends more tagged rows to an existing pooled entry. Schema unchanged — the
   * caller has already validated the files against the entry's columns.
   *
   * Unlike `appendRows` this does NOT use INSERT OR IGNORE: two devices legitimately
   * report the same timestamp, and silently dropping the second one loses a whole
   * source. A real constraint violation therefore throws and rolls back, which is the
   * honest outcome.
   */
  appendPooledRows(id: number, rows: string[][]): IngestResult;

  /** The distinct values of one source column, for the Compare screen's pickers. */
  listSourceValues(id: number, columnName: string): string[];

  updateMetadata(id: number, input: { name: string; description?: string }): CsvAnalyticEntry;
  /** Deletes the metadata row, drops the physical table, and removes the entry's chart presets. */
  deleteEntry(id: number): void;

  /** Named chart presets for one entry, oldest first. */
  listChartPresets(entryId: number): CsvChartPreset[];
  /** Upserts a preset by (entryId, name) — a repeat name overwrites its options. */
  saveChartPreset(input: SaveChartPresetInput): CsvChartPreset;
  deleteChartPreset(id: number): void;

  /** Custom views for one entry, oldest first. Includes disabled ones. */
  listCustomViews(entryId: number): CsvCustomView[];
  /** Every custom view across every entry, for the builder's list. */
  listAllCustomViews(): CsvCustomView[];
  getCustomViewById(id: number): CsvCustomView | undefined;
  isCustomViewNameTaken(entryId: number, name: string, excludingId?: number): boolean;
  createCustomView(input: CreateCsvCustomViewInput): CsvCustomView;
  updateCustomView(id: number, input: UpdateCsvCustomViewInput): CsvCustomView;
  /** Flips just `is_enabled` — the rest of the definition is untouched. */
  setCustomViewEnabled(id: number, isEnabled: boolean): CsvCustomView;
  deleteCustomView(id: number): void;
  /**
   * Runs the view against its entry's physical table and returns one page.
   * Compiles the SQL via `compileViewQuery`, so the repository holds no query logic
   * of its own beyond binding and paging.
   */
  readCustomViewPage(view: CsvCustomView, page: number): CsvViewPage;
}
