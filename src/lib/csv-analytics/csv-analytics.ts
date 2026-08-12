import { parseCsv } from "@/lib/shared/csv";
import type { CsvAnalyticsRepository } from "./ports";
import {
  createCsvAnalyticEntrySchema,
  saveChartPresetSchema,
  updateCsvAnalyticEntrySchema,
  type CreateCsvAnalyticEntryInput,
  type SaveChartPresetInput,
  type UpdateCsvAnalyticEntryInput,
} from "./schema";
import { dedupeColumnNames, inferColumnType } from "./sql-builder";
import type {
  CsvAnalyticEntry,
  CsvChartPreset,
  CsvColumnDefinition,
  CsvEntryData,
  IngestResult,
} from "./types";

const PREVIEW_ROW_COUNT = 5;

export interface CsvAnalyticsPreview {
  headers: string[];
  totalRows: number;
  previewRows: string[][];
  /** One suggested column definition per header, in file-column order. */
  suggestedColumns: CsvColumnDefinition[];
}

/** Parses a CSV and suggests sanitized column names + inferred types — pure, no persistence. */
export function previewCsvFile(fileText: string): CsvAnalyticsPreview {
  const { headers, rows } = parseCsv(fileText);
  const sanitizedNames = dedupeColumnNames(headers);
  const previewRows = rows.slice(0, PREVIEW_ROW_COUNT);

  const suggestedColumns: CsvColumnDefinition[] = headers.map((sourceHeader, index) => ({
    name: sanitizedNames[index],
    sourceHeader,
    type: inferColumnType(previewRows.map((row) => row[index] ?? "")),
  }));

  return { headers, totalRows: rows.length, previewRows, suggestedColumns };
}

export function listEntries(repo: CsvAnalyticsRepository): CsvAnalyticEntry[] {
  return repo.listEntries();
}

export function getEntryById(repo: CsvAnalyticsRepository, id: number): CsvAnalyticEntry | undefined {
  return repo.getEntryById(id);
}

/** Reads an entry's table data (columns + row values) for viewing in a grid or charting. */
export function readEntryData(repo: CsvAnalyticsRepository, id: number, limit?: number): CsvEntryData {
  return repo.readTableData(id, limit);
}

export function createEntry(
  repo: CsvAnalyticsRepository,
  input: CreateCsvAnalyticEntryInput,
): CsvAnalyticEntry {
  const validated = createCsvAnalyticEntrySchema.parse(input);
  const { rows } = parseCsv(validated.fileText);
  return repo.createEntry(validated, rows);
}

/**
 * Header order must exactly match the entry's existing columns — append/truncate insert
 * positionally, so a mismatched file would silently scramble data into the wrong columns.
 */
function assertHeadersMatchEntry(entry: CsvAnalyticEntry, headers: string[]): void {
  const expected = entry.columns.map((column) => column.sourceHeader);
  const matches = expected.length === headers.length && expected.every((header, i) => header === headers[i]);
  if (!matches) {
    throw new Error(
      `This file's columns (${headers.join(", ")}) don't match "${entry.name}"'s existing columns ` +
        `(${expected.join(", ")}). Use Overwrite to redefine the schema instead.`,
    );
  }
}

export interface UpdateEntryResult {
  entry: CsvAnalyticEntry;
  /** Only set when this update ingested a file under "append" or "truncate". */
  ingestResult?: IngestResult;
}

export function updateEntry(
  repo: CsvAnalyticsRepository,
  id: number,
  input: UpdateCsvAnalyticEntryInput,
): UpdateEntryResult {
  const validated = updateCsvAnalyticEntrySchema.parse(input);
  const entry = repo.updateMetadata(id, { name: validated.name, description: validated.description });

  if (!validated.ingest) return { entry };
  const { ingest } = validated;
  const { headers, rows } = parseCsv(ingest.fileText);

  if (ingest.mode === "overwrite") {
    const overwritten = repo.overwriteEntry(
      id,
      {
        name: validated.name,
        description: validated.description,
        tableBaseName: ingest.tableBaseName ?? entry.tableName.replace(/^csv_/, ""),
        columns: ingest.columns ?? [],
        primaryKeyFields: ingest.primaryKeyFields ?? [],
        fileText: ingest.fileText,
      },
      rows,
    );
    return { entry: overwritten };
  }

  // For append/truncate: the CSV headers must match existing columns.
  // If newColumnValues are provided, add those columns' values to each row.
  assertHeadersMatchEntry(entry, headers);

  let rowsToIngest = rows;
  if (ingest.newColumnValues && Object.keys(ingest.newColumnValues).length > 0) {
    // Find the indices of new columns in entry.columns to know where to inject values
    const newColumnEntries = Object.entries(ingest.newColumnValues);
    const newColumnIndices = newColumnEntries.map(([name]) =>
      entry.columns.findIndex((col) => col.name === name)
    );

    // Inject the new column values into each row
    // Rows are arrays matching entry.columns.length in order, with new columns at the end
    rowsToIngest = rows.map((row) => {
      const expandedRow = [...row];
      // Ensure the row array is large enough for new columns
      while (expandedRow.length < entry.columns.length) {
        expandedRow.push("");
      }
      // Place new column values at their column positions
      newColumnEntries.forEach(([name, value]) => {
        const idx = entry.columns.findIndex((col) => col.name === name);
        if (idx >= 0) {
          expandedRow[idx] = value;
        }
      });
      return expandedRow;
    });
  }

  const ingestResult: IngestResult =
    ingest.mode === "append"
      ? repo.appendRows(id, rowsToIngest)
      : repo.truncateAndReload(id, rowsToIngest);
  return { entry: repo.getEntryById(id) ?? entry, ingestResult };
}

export function deleteEntry(repo: CsvAnalyticsRepository, id: number): void {
  repo.deleteEntry(id);
}

export function listChartPresets(repo: CsvAnalyticsRepository, entryId: number): CsvChartPreset[] {
  return repo.listChartPresets(entryId);
}

/** Saves (or overwrites by name) a named chart preset for an entry. */
export function saveChartPreset(repo: CsvAnalyticsRepository, input: SaveChartPresetInput): CsvChartPreset {
  const validated = saveChartPresetSchema.parse(input);
  return repo.saveChartPreset(validated);
}

export function deleteChartPreset(repo: CsvAnalyticsRepository, id: number): void {
  repo.deleteChartPreset(id);
}
