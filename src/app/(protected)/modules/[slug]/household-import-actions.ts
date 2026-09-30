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
  autoMapRecipeHeaders,
  importRecipesCsv,
  planRecipeImport,
  testRecipeImport,
} from "@/lib/household";
import type { RecipeImportPlan, RecipeTestRow } from "@/lib/household";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "../../require-access";

/** The module these actions belong to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "household";

const RECIPES_PATH = "/modules/household/recipes";

/**
 * The value that ties a saved mapping to this module in the shared
 * `csv_named_mappings` table. Every importer in the app writes to that one
 * table and is separated only by this — see coding-guide.md, "CSV import".
 */
const RECIPE_IMPORT_TYPE = "Recipe" as const;

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function toErrorResult(error: unknown, fallback: string): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

export interface RecipePreviewResult extends ActionResult {
  preview?: CsvPreview;
  /** Mapping + options guessed from the file's headers, offered as a starting point. */
  autoMapping?: ColumnMapping;
  autoFieldOptions?: FieldOptionsMap;
  namedMappings?: NamedMapping[];
}

export async function previewRecipeCsvAction(fileText: string): Promise<RecipePreviewResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const preview = previewCsv(fileText);
    const { columnMapping, fieldOptions } = autoMapRecipeHeaders(preview.headers);
    return {
      ok: true,
      preview,
      autoMapping: columnMapping,
      autoFieldOptions: fieldOptions,
      namedMappings: listNamedMappings(deps.csvImportMappingRepo, RECIPE_IMPORT_TYPE),
    };
  } catch (error) {
    return toErrorResult(error, "Failed to preview CSV.");
  }
}

export async function saveRecipeMappingAction(
  name: string,
  columnMapping: ColumnMapping,
  fieldOptions: FieldOptionsMap,
): Promise<ActionResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    createNamedMapping(deps.csvImportMappingRepo, {
      name,
      importType: RECIPE_IMPORT_TYPE,
      columnMapping,
      fieldOptions,
    });
  } catch (error) {
    return toErrorResult(error, "Failed to save mapping.");
  }
  revalidatePath(RECIPES_PATH);
  return { ok: true };
}

export async function updateRecipeMappingAction(
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
  revalidatePath(RECIPES_PATH);
  return { ok: true };
}

export async function deleteRecipeMappingAction(id: number): Promise<ActionResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    deleteNamedMapping(deps.csvImportMappingRepo, id);
  } catch (error) {
    return toErrorResult(error, "Failed to delete mapping.");
  }
  revalidatePath(RECIPES_PATH);
  return { ok: true };
}

export interface RecipeImportPlanResult extends ActionResult {
  plan?: RecipeImportPlan;
}

/**
 * Works out what an overwrite import would do, without writing anything — the
 * list the confirmation dialog shows before the reader commits.
 */
export async function planRecipeImportAction(
  fileText: string,
  columnMapping: ColumnMapping,
  fieldOptions: FieldOptionsMap,
  skipDuplicates = true,
  overwrite = false,
  excludedRowIndexes: number[] = [],
): Promise<RecipeImportPlanResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const plan = planRecipeImport(deps.householdRepo, fileText, columnMapping, fieldOptions, {
      skipDuplicates,
      overwrite,
      excludedRowIndexes,
    });
    return { ok: true, plan };
  } catch (error) {
    return toErrorResult(error, "Failed to inspect CSV.");
  }
}

export interface RecipeImportResult extends ActionResult {
  summary?: ImportSummary;
}

export async function runRecipeImportAction(
  fileText: string,
  columnMapping: ColumnMapping,
  fieldOptions: FieldOptionsMap,
  skipDuplicates = true,
  overwrite = false,
  excludedRowIndexes: number[] = [],
): Promise<RecipeImportResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const summary = importRecipesCsv(deps.householdRepo, fileText, columnMapping, fieldOptions, {
      skipDuplicates,
      overwrite,
      excludedRowIndexes,
    });
    revalidatePath(RECIPES_PATH);
    return { ok: true, summary };
  } catch (error) {
    return toErrorResult(error, "Failed to import CSV.");
  }
}

export interface RecipeTestResult extends ActionResult {
  rows?: RecipeTestRow[];
}

/**
 * Parses the selected rows and returns what would be stored. Writes nothing,
 * so there is no `revalidatePath` and no duplicate check — this is about the
 * mapping being right, not about what is already in the box.
 */
export async function testRecipeImportAction(
  fileText: string,
  columnMapping: ColumnMapping,
  fieldOptions: FieldOptionsMap,
  excludedRowIndexes: number[] = [],
): Promise<RecipeTestResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    return { ok: true, rows: testRecipeImport(fileText, columnMapping, fieldOptions, excludedRowIndexes) };
  } catch (error) {
    return toErrorResult(error, "Failed to parse the selected rows.");
  }
}
