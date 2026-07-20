"use server";

import { revalidatePath } from "next/cache";
import {
  createEntry,
  deleteEntry,
  previewCsvFile,
  updateEntry,
  type CsvAnalyticsPreview,
  type CsvColumnDefinition,
  type IngestMode,
  type IngestResult,
} from "@/lib/csv-analytics";
import { deps } from "@/lib/wiring";

const CSV_ANALYSIS_MODULE_PATH = "/modules/csv-analysis";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface PreviewResult extends ActionResult {
  preview?: CsvAnalyticsPreview;
}

export interface CreateEntryInput {
  name: string;
  description?: string;
  tableBaseName: string;
  columns: CsvColumnDefinition[];
  primaryKeyFields: string[];
  fileText: string;
}

export interface UpdateEntryInput {
  name: string;
  description?: string;
  ingest?: {
    mode: IngestMode;
    fileText: string;
    tableBaseName?: string;
    columns?: CsvColumnDefinition[];
    primaryKeyFields?: string[];
  };
}

export interface UpdateEntryActionResult extends ActionResult {
  ingestResult?: IngestResult;
}

function toErrorResult(error: unknown, fallback: string): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

export async function previewCsvAnalyticsFileAction(fileText: string): Promise<PreviewResult> {
  try {
    const preview = previewCsvFile(fileText);
    return { ok: true, preview };
  } catch (error) {
    return toErrorResult(error, "Failed to read that file.");
  }
}

export async function createCsvAnalyticsEntryAction(input: CreateEntryInput): Promise<ActionResult> {
  try {
    createEntry(deps.csvAnalyticsRepo, input);
  } catch (error) {
    return toErrorResult(error, "Failed to create entry.");
  }
  revalidatePath(CSV_ANALYSIS_MODULE_PATH);
  return { ok: true };
}

export async function updateCsvAnalyticsEntryAction(
  id: number,
  input: UpdateEntryInput,
): Promise<UpdateEntryActionResult> {
  try {
    const result = updateEntry(deps.csvAnalyticsRepo, id, input);
    revalidatePath(CSV_ANALYSIS_MODULE_PATH);
    return { ok: true, ingestResult: result.ingestResult };
  } catch (error) {
    return toErrorResult(error, "Failed to save changes.");
  }
}

export async function deleteCsvAnalyticsEntryAction(id: number): Promise<ActionResult> {
  try {
    deleteEntry(deps.csvAnalyticsRepo, id);
  } catch (error) {
    return toErrorResult(error, "Failed to delete entry.");
  }
  revalidatePath(CSV_ANALYSIS_MODULE_PATH);
  return { ok: true };
}
