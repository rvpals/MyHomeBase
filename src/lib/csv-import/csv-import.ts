import { autoMapHeaders, parseCsv } from "./csv-parser";
import type { CsvImportMappingRepository } from "./ports";
import { createNamedMappingSchema, saveCurrentMappingSchema } from "./schema";
import type { CreateNamedMappingInput, SaveCurrentMappingInput } from "./schema";
import type { ColumnMapping, CsvPreview, ImportRowResult, ImportSummary, ImportType, NamedMapping } from "./types";

const PREVIEW_ROW_COUNT = 3;

/** Parses a CSV and guesses a column mapping — pure, no persistence. */
export function previewCsv(fileText: string): CsvPreview {
  const { headers, rows } = parseCsv(fileText);
  return {
    headers,
    totalRows: rows.length,
    previewRows: rows.slice(0, PREVIEW_ROW_COUNT),
    autoMapping: autoMapHeaders(headers),
  };
}

export function getCurrentMapping(
  repo: CsvImportMappingRepository,
  importType: ImportType,
): ColumnMapping | undefined {
  return repo.getCurrentMapping(importType);
}

export function saveCurrentMapping(repo: CsvImportMappingRepository, input: SaveCurrentMappingInput): void {
  const validated = saveCurrentMappingSchema.parse(input);
  repo.saveCurrentMapping(validated.importType, validated.columnMapping);
}

export function listNamedMappings(repo: CsvImportMappingRepository, importType: ImportType): NamedMapping[] {
  return repo.listNamedMappings(importType);
}

export function createNamedMapping(
  repo: CsvImportMappingRepository,
  input: CreateNamedMappingInput,
): NamedMapping {
  const validated = createNamedMappingSchema.parse(input);
  return repo.createNamedMapping(validated);
}

export function deleteNamedMapping(repo: CsvImportMappingRepository, id: number): void {
  repo.deleteNamedMapping(id);
}

/** Rolls up per-row import results into a summary — shared by every import type. */
export function summarizeImportResults(results: ImportRowResult[]): ImportSummary {
  return {
    importedCount: results.filter((result) => result.status === "imported").length,
    skippedCount: results.filter((result) => result.status === "skipped").length,
    results,
  };
}
