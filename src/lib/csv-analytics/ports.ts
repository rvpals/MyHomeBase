import type { CreateCsvAnalyticEntryInput, SaveChartPresetInput, UpdateCsvAnalyticEntryInput } from "./schema";
import type { CsvAnalyticEntry, CsvChartPreset, CsvEntryData, IngestResult } from "./types";

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
  /** Drops the entry's old physical table, creates a new one from `input`, loads its rows. */
  overwriteEntry(id: number, input: CreateCsvAnalyticEntryInput, rows: string[][]): CsvAnalyticEntry;
  updateMetadata(id: number, input: { name: string; description?: string }): CsvAnalyticEntry;
  /** Deletes the metadata row, drops the physical table, and removes the entry's chart presets. */
  deleteEntry(id: number): void;

  /** Named chart presets for one entry, oldest first. */
  listChartPresets(entryId: number): CsvChartPreset[];
  /** Upserts a preset by (entryId, name) — a repeat name overwrites its options. */
  saveChartPreset(input: SaveChartPresetInput): CsvChartPreset;
  deleteChartPreset(id: number): void;
}
