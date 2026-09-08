import { parseCsv } from "@/lib/shared/csv";
import type { CsvAnalyticsRepository } from "./ports";
import {
  createCsvAnalyticEntrySchema,
  csvBulkEditSchema,
  saveChartPresetSchema,
  updateCsvAnalyticEntrySchema,
  type CreateCsvAnalyticEntryInput,
  type CsvBulkEditChanges,
  type SaveChartPresetInput,
  type UpdateCsvAnalyticEntryInput,
} from "./schema";
import { coerceCellValue, dedupeColumnNames, inferColumnType } from "./sql-builder";
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
  const { headers, rows } = parseCsv(validated.fileText);

  // Columns beyond the file's own headers have no data in the CSV at all — each one needs
  // a fixed value (in newColumnValues) to apply to every imported row.
  const newColumns = validated.columns.slice(headers.length);
  const missingValue = newColumns.find((column) => !validated.newColumnValues?.[column.name]?.trim());
  if (missingValue) {
    throw new Error(`Column "${missingValue.sourceHeader}" has no header in the file — provide a value for it.`);
  }

  let rowsToInsert = rows;
  if (validated.newColumnValues && Object.keys(validated.newColumnValues).length > 0) {
    const newColumnEntries = Object.entries(validated.newColumnValues);
    // New columns (no header in the file) are appended at the end of `columns`, in the
    // same order the user added them — inject each one's fixed value into every row.
    rowsToInsert = rows.map((row) => {
      const expandedRow = [...row];
      while (expandedRow.length < validated.columns.length) {
        expandedRow.push("");
      }
      newColumnEntries.forEach(([name, value]) => {
        const idx = validated.columns.findIndex((col) => col.name === name);
        if (idx >= 0) {
          expandedRow[idx] = value;
        }
      });
      return expandedRow;
    });
  }

  return repo.createEntry(validated, rowsToInsert);
}

/**
 * Header order must exactly match the entry's existing columns, excluding any brand-new
 * columns being added in this same ingest (those have no header in the file at all — the
 * user types one literal value applied to every row instead). Append/truncate insert
 * positionally, so a mismatched file would otherwise silently scramble data into the wrong columns.
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

  // For append/truncate: the CSV headers must match the entry's existing columns
  // (brand-new columns have no header in the file — they're added below instead).
  assertHeadersMatchEntry(entry, headers);

  // `ingest.columns` here is only the NEW columns being added in this ingest (see schema.ts).
  // Extend the physical table + columns_json BEFORE inserting, so there's somewhere for the
  // injected value to land.
  let workingEntry = entry;
  if (ingest.columns && ingest.columns.length > 0) {
    workingEntry = repo.addColumns(id, ingest.columns);
  }

  let rowsToIngest = rows;
  if (ingest.newColumnValues && Object.keys(ingest.newColumnValues).length > 0) {
    const newColumnEntries = Object.entries(ingest.newColumnValues);

    // Rows are arrays matching workingEntry.columns.length in order, with new columns at the end.
    rowsToIngest = rows.map((row) => {
      const expandedRow = [...row];
      while (expandedRow.length < workingEntry.columns.length) {
        expandedRow.push("");
      }
      newColumnEntries.forEach(([name, value]) => {
        const idx = workingEntry.columns.findIndex((col) => col.name === name);
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
  return { entry: repo.getEntryById(id) ?? workingEntry, ingestResult };
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

// --- Bulk edit ---------------------------------------------------------------

/**
 * How many rowids go into one UPDATE. SQLite's default host-parameter ceiling is 999,
 * and the change values need a few of those, so the selection is applied in chunks
 * rather than refused. The repository runs every chunk in one transaction, so a
 * chunked edit is still all-or-nothing.
 */
const BULK_UPDATE_CHUNK_SIZE = 400;

/**
 * Which columns a bulk edit may never write, for one entry.
 *
 * An entry's `primaryKeyFields` are excluded because a bulk edit sets the *same* value
 * on every selected row: writing a PK column would collide the key the moment two rows
 * are selected, failing the whole batch. Nothing is gained by letting the user discover
 * that from a SQLite constraint error, so the rule is stated here and the UI reads it
 * to disable those fields. An entry with no `primaryKeyFields` has a surrogate
 * `_row_id` that is not in `columns` at all, so there is nothing to protect.
 */
export function nonEditableColumns(entry: CsvAnalyticEntry): string[] {
  return [...entry.primaryKeyFields];
}

export interface CsvBulkEditResult {
  /** Rows actually written, as reported by SQLite. */
  updated: number;
  /** The column names that were set, in the entry's column order. */
  fields: string[];
}

/**
 * Applies the same value to the same columns across a selection of rows.
 *
 * Only the columns named in `changes` are written; every other column on each row is
 * left alone, so this cannot clobber the parts of a row the caller wasn't editing.
 *
 * Three rules, all enforced here rather than in the UI so the CLI gets them too:
 *
 *   - **A named column must exist on the entry.** An unknown name throws rather than
 *     being skipped — unlike a *view*, which forgives a since-dropped column because
 *     it was saved before the schema changed. A bulk edit is composed against the
 *     schema as it is right now, so an unknown column means the caller is confused,
 *     and silently writing the other columns would be a half-applied edit.
 *   - **A primary-key column is refused** (see `nonEditableColumns`).
 *   - **Values are coerced per the column's declared type**, through the same
 *     `coerceCellValue` an import uses. So a bulk edit can't put text in an integer
 *     column, and an unparseable value becomes NULL exactly as it would on import.
 *     `null` (or an empty string) clears the column.
 */
export function bulkEditRows(
  repo: CsvAnalyticsRepository,
  entryId: number,
  rowIds: number[],
  changes: CsvBulkEditChanges,
): CsvBulkEditResult {
  const validated = csvBulkEditSchema.parse({ entryId, rowIds, changes });

  const entry = repo.getEntryById(validated.entryId);
  if (!entry) throw new Error(`CSV analytic entry ${validated.entryId} not found.`);

  const columnsByName = new Map(entry.columns.map((column) => [column.name, column]));
  // `Object.keys`, and a Set from it, rather than the `in` operator anywhere below:
  // the change set arrives as parsed JSON from a server action or a CLI flag, and `in`
  // would also answer true for inherited keys like "constructor", letting a column
  // name nobody declared reach the field list.
  const changedColumns = Object.keys(validated.changes);
  const changed = new Set(changedColumns);
  const unknown = changedColumns.filter((name) => !columnsByName.has(name));
  if (unknown.length > 0) {
    throw new Error(`Unknown column(s) for this dataset: ${unknown.join(", ")}.`);
  }

  const protectedColumns = new Set(nonEditableColumns(entry));
  const refused = changedColumns.filter((name) => protectedColumns.has(name));
  if (refused.length > 0) {
    throw new Error(
      `Primary key column(s) can't be bulk edited: ${refused.join(", ")}. Every selected row would get the same key.`,
    );
  }

  // Coerce in the entry's column order, so the generated SQL is stable regardless of
  // the order the caller happened to build the object in.
  const fields = entry.columns
    .map((column) => column.name)
    .filter((name) => changed.has(name));

  const values: Record<string, string | number | null> = {};
  for (const name of fields) {
    const raw = validated.changes[name];
    const column = columnsByName.get(name);
    if (!column) continue; // unreachable — checked above; keeps the map lookup honest
    values[name] = raw === null ? null : coerceCellValue(raw, column.type);
  }

  // Dedupe: a selection can repeat a rowid, and the IN (…) list shouldn't.
  const uniqueRowIds = [...new Set(validated.rowIds)];

  const chunks: number[][] = [];
  for (let index = 0; index < uniqueRowIds.length; index += BULK_UPDATE_CHUNK_SIZE) {
    chunks.push(uniqueRowIds.slice(index, index + BULK_UPDATE_CHUNK_SIZE));
  }

  const updated = repo.bulkUpdateRows(validated.entryId, chunks, fields, values);
  return { updated, fields };
}
