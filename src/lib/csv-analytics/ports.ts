import type { CreateCsvAnalyticEntryInput, UpdateCsvAnalyticEntryInput } from "./schema";
import type { CsvAnalyticEntry, IngestResult } from "./types";

// The use-cases depend on THIS interface, not on a concrete database.
export interface CsvAnalyticsRepository {
  listEntries(): CsvAnalyticEntry[];
  getEntryById(id: number): CsvAnalyticEntry | undefined;
  isTableNameTaken(tableName: string, excludingId?: number): boolean;
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
  /** Drops the entry's old physical table, creates a new one from `input`, loads its rows. */
  overwriteEntry(id: number, input: CreateCsvAnalyticEntryInput, rows: string[][]): CsvAnalyticEntry;
  updateMetadata(id: number, input: { name: string; description?: string }): CsvAnalyticEntry;
  /** Deletes the metadata row and drops the physical table. */
  deleteEntry(id: number): void;
}
