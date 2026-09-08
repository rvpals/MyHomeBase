"use server";

import { revalidatePath } from "next/cache";
import {
  bulkEditRows,
  createCustomView,
  createEntry,
  deleteChartPreset,
  deleteCustomView,
  deleteEntry,
  listAllCustomViews,
  listChartPresets,
  listCustomViews,
  listEnabledCustomViews,
  previewCsvFile,
  readCustomViewPage,
  readEntryData,
  saveChartPreset,
  setCustomViewEnabled,
  updateCustomView,
  updateEntry,
  type CreateCsvCustomViewInput,
  type CsvAnalyticsPreview,
  type CsvChartPreset,
  type CsvBulkEditChanges,
  type CsvColumnDefinition,
  type CsvCustomView,
  type CsvEntryData,
  type CsvViewPage,
  type IngestMode,
  type IngestResult,
  type UpdateCsvCustomViewInput,
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

export interface EntryDataResult extends ActionResult {
  data?: CsvEntryData;
}

export interface ChartPresetsResult extends ActionResult {
  presets?: CsvChartPreset[];
}

export interface BulkEditResult extends ActionResult {
  /** Rows actually written. */
  updated?: number;
}

export interface CreateEntryInput {
  name: string;
  description?: string;
  tableBaseName: string;
  columns: CsvColumnDefinition[];
  primaryKeyFields: string[];
  fileText: string;
  newColumnValues?: Record<string, string>;
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
    newColumnValues?: Record<string, string>;
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

export async function readCsvAnalyticsDataAction(id: number, limit?: number): Promise<EntryDataResult> {
  try {
    const data = readEntryData(deps.csvAnalyticsRepo, id, limit);
    return { ok: true, data };
  } catch (error) {
    return toErrorResult(error, "Failed to read table data.");
  }
}

export async function listChartPresetsAction(entryId: number): Promise<ChartPresetsResult> {
  try {
    const presets = listChartPresets(deps.csvAnalyticsRepo, entryId);
    return { ok: true, presets };
  } catch (error) {
    return toErrorResult(error, "Failed to load saved charts.");
  }
}

export async function saveChartPresetAction(
  entryId: number,
  name: string,
  optionsJson: string,
): Promise<ActionResult> {
  try {
    saveChartPreset(deps.csvAnalyticsRepo, { entryId, name, optionsJson });
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Failed to save chart.");
  }
}

export async function deleteChartPresetAction(id: number): Promise<ActionResult> {
  try {
    deleteChartPreset(deps.csvAnalyticsRepo, id);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Failed to delete saved chart.");
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

// --- Custom views (migration 0081) ------------------------------------------------
//
// Every one of these is the same three lines: validate nothing here, call the
// use-case, translate a thrown error into a result the view can render. The rules
// (unknown column, incomplete criterion, duplicate name, disabled view) all live in
// src/lib/csv-analytics/custom-views.ts.

export interface CustomViewsResult extends ActionResult {
  views?: CsvCustomView[];
}

export interface CustomViewResult extends ActionResult {
  view?: CsvCustomView;
}

export interface CustomViewPageResult extends ActionResult {
  page?: CsvViewPage;
}

export async function listCsvCustomViewsAction(entryId: number): Promise<CustomViewsResult> {
  try {
    return { ok: true, views: listCustomViews(deps.csvAnalyticsRepo, entryId) };
  } catch (error) {
    return toErrorResult(error, "Failed to load custom views.");
  }
}

export async function listAllCsvCustomViewsAction(): Promise<CustomViewsResult> {
  try {
    return { ok: true, views: listAllCustomViews(deps.csvAnalyticsRepo) };
  } catch (error) {
    return toErrorResult(error, "Failed to load custom views.");
  }
}

/** Only the views an entry may offer in its dropdown — enabled ones. */
export async function listEnabledCsvCustomViewsAction(entryId: number): Promise<CustomViewsResult> {
  try {
    return { ok: true, views: listEnabledCustomViews(deps.csvAnalyticsRepo, entryId) };
  } catch (error) {
    return toErrorResult(error, "Failed to load custom views.");
  }
}

export async function createCsvCustomViewAction(
  input: CreateCsvCustomViewInput,
): Promise<CustomViewResult> {
  try {
    const view = createCustomView(deps.csvAnalyticsRepo, input);
    revalidatePath(CSV_ANALYSIS_MODULE_PATH);
    return { ok: true, view };
  } catch (error) {
    return toErrorResult(error, "Failed to save the custom view.");
  }
}

export async function updateCsvCustomViewAction(
  id: number,
  input: UpdateCsvCustomViewInput,
): Promise<CustomViewResult> {
  try {
    const view = updateCustomView(deps.csvAnalyticsRepo, id, input);
    revalidatePath(CSV_ANALYSIS_MODULE_PATH);
    return { ok: true, view };
  } catch (error) {
    return toErrorResult(error, "Failed to save the custom view.");
  }
}

export async function setCsvCustomViewEnabledAction(
  id: number,
  isEnabled: boolean,
): Promise<CustomViewResult> {
  try {
    const view = setCustomViewEnabled(deps.csvAnalyticsRepo, id, isEnabled);
    revalidatePath(CSV_ANALYSIS_MODULE_PATH);
    return { ok: true, view };
  } catch (error) {
    return toErrorResult(error, "Failed to change the custom view.");
  }
}

export async function deleteCsvCustomViewAction(id: number): Promise<ActionResult> {
  try {
    deleteCustomView(deps.csvAnalyticsRepo, id);
  } catch (error) {
    return toErrorResult(error, "Failed to delete the custom view.");
  }
  revalidatePath(CSV_ANALYSIS_MODULE_PATH);
  return { ok: true };
}

/**
 * One page of a dataset read through a view. Called on every page change, so it
 * deliberately does not revalidate — this is a read, and re-rendering the whole
 * module route to turn a page would throw away the panel's own state.
 */
export async function readCsvCustomViewPageAction(
  viewId: number,
  page: number,
): Promise<CustomViewPageResult> {
  try {
    return { ok: true, page: readCustomViewPage(deps.csvAnalyticsRepo, { viewId, page }) };
  } catch (error) {
    return toErrorResult(error, "Failed to read the view.");
  }
}

/**
 * Applies one value per named column to every selected row of a dataset.
 *
 * Revalidates: the grid's row count and the entry list are server-rendered, and the
 * caller re-reads the panel's data afterwards to show the new values.
 */
export async function bulkEditCsvRowsAction(
  entryId: number,
  rowIds: number[],
  changes: CsvBulkEditChanges,
): Promise<BulkEditResult> {
  let updated: number;
  try {
    updated = bulkEditRows(deps.csvAnalyticsRepo, entryId, rowIds, changes).updated;
  } catch (error) {
    return toErrorResult(error, "Failed to apply the bulk edit.");
  }
  revalidatePath(CSV_ANALYSIS_MODULE_PATH);
  return { ok: true, updated };
}
