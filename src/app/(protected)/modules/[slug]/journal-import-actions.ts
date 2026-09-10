"use server";

import { revalidatePath } from "next/cache";
import {
  createNamedMapping,
  deleteNamedMapping,
  listNamedMappings,
  previewCsv,
  updateNamedMapping,
  type ColumnMapping,
  type CsvPreview,
  type FieldOptionsMap,
  type ImportSummary,
  type NamedMapping,
} from "@/lib/csv-import";
import {
  autoMapJournalHeaders,
  clearAllEntries,
  countAllEntries,
  importJournalCsv,
  planJournalImport,
} from "@/lib/journal";
import type { JournalEntryTally, JournalImportPlan } from "@/lib/journal";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "../../require-access";

/** The module these actions belong to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "journal";

const JOURNAL_MODULE_PATH = "/modules/journal";
const JOURNAL_IMPORT_TYPE = "Journal" as const;

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function toErrorResult(error: unknown, fallback: string): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

export interface JournalPreviewResult extends ActionResult {
  preview?: CsvPreview;
  /** Mapping + options guessed from the file's headers, offered as a starting point. */
  autoMapping?: ColumnMapping;
  autoFieldOptions?: FieldOptionsMap;
  namedMappings?: NamedMapping[];
}

export async function previewJournalCsvAction(fileText: string): Promise<JournalPreviewResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const preview = previewCsv(fileText);
    const { columnMapping, fieldOptions } = autoMapJournalHeaders(preview.headers);
    return {
      ok: true,
      preview,
      autoMapping: columnMapping,
      autoFieldOptions: fieldOptions,
      namedMappings: listNamedMappings(deps.csvImportMappingRepo, JOURNAL_IMPORT_TYPE),
    };
  } catch (error) {
    return toErrorResult(error, "Failed to preview CSV.");
  }
}

export async function saveJournalMappingAction(
  name: string,
  columnMapping: ColumnMapping,
  fieldOptions: FieldOptionsMap,
): Promise<ActionResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    createNamedMapping(deps.csvImportMappingRepo, {
      name,
      importType: JOURNAL_IMPORT_TYPE,
      columnMapping,
      fieldOptions,
    });
  } catch (error) {
    return toErrorResult(error, "Failed to save mapping.");
  }
  revalidatePath(JOURNAL_MODULE_PATH);
  return { ok: true };
}

export async function updateJournalMappingAction(
  id: number,
  name: string,
  columnMapping: ColumnMapping,
  fieldOptions: FieldOptionsMap,
): Promise<ActionResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    updateNamedMapping(deps.csvImportMappingRepo, id, { name, columnMapping, fieldOptions });
  } catch (error) {
    return toErrorResult(error, "Failed to update mapping.");
  }
  revalidatePath(JOURNAL_MODULE_PATH);
  return { ok: true };
}

export async function deleteJournalMappingAction(id: number): Promise<ActionResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    deleteNamedMapping(deps.csvImportMappingRepo, id);
  } catch (error) {
    return toErrorResult(error, "Failed to delete mapping.");
  }
  revalidatePath(JOURNAL_MODULE_PATH);
  return { ok: true };
}

export interface JournalImportPlanResult extends ActionResult {
  plan?: JournalImportPlan;
}

/**
 * Works out what an overwrite import would do, without writing anything — the
 * list the confirmation dialog shows before the reader commits.
 */
export async function planJournalImportAction(
  fileText: string,
  columnMapping: ColumnMapping,
  fieldOptions: FieldOptionsMap,
  skipDuplicates = true,
  overwrite = false,
): Promise<JournalImportPlanResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const plan = planJournalImport(deps.journalRepo, fileText, columnMapping, fieldOptions, {
      skipDuplicates,
      overwrite,
    });
    return { ok: true, plan };
  } catch (error) {
    return toErrorResult(error, "Failed to inspect CSV.");
  }
}

export interface JournalImportResult extends ActionResult {
  summary?: ImportSummary;
}

export async function runJournalImportAction(
  fileText: string,
  columnMapping: ColumnMapping,
  fieldOptions: FieldOptionsMap,
  skipDuplicates = true,
  overwrite = false,
): Promise<JournalImportResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const summary = importJournalCsv(deps.journalRepo, fileText, columnMapping, fieldOptions, {
      skipDuplicates,
      overwrite,
    });
    revalidatePath(JOURNAL_MODULE_PATH);
    return { ok: true, summary };
  } catch (error) {
    return toErrorResult(error, "Failed to import CSV.");
  }
}

export interface JournalEntryTallyResult extends ActionResult {
  tally?: JournalEntryTally;
}

/**
 * The live entry count behind the clear-all warning. Read on click rather than
 * rendered with the page, so the number in the dialog is never a stale one from
 * before an import.
 */
export async function countJournalEntriesAction(): Promise<JournalEntryTallyResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    return { ok: true, tally: countAllEntries(deps.journalRepo) };
  } catch (error) {
    return toErrorResult(error, "Failed to count journal entries.");
  }
}

export interface ClearJournalEntriesResult extends ActionResult {
  deletedCount?: number;
}

/** Empties the journal. Entries only — categories, tags and filters survive. */
export async function clearAllJournalEntriesAction(): Promise<ClearJournalEntriesResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const { deletedCount } = clearAllEntries(deps.journalRepo);
    revalidatePath(JOURNAL_MODULE_PATH);
    return { ok: true, deletedCount };
  } catch (error) {
    return toErrorResult(error, "Failed to clear journal entries.");
  }
}
