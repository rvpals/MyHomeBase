"use server";

import { revalidatePath } from "next/cache";
import {
  createNamedMapping,
  deleteNamedMapping,
  getCurrentMapping,
  listNamedMappings,
  previewCsv,
  saveCurrentMapping,
  type ColumnMapping,
  type CsvPreview,
  type ImportSummary,
  type ImportType,
  type NamedMapping,
} from "@/lib/csv-import";
import { extractCsvAccountNames, importPerformanceFromCsv, listAccounts } from "@/lib/investment-accounts";
import { importPositionsFromCsv, importTransactionsFromCsv } from "@/lib/stock-positions";
import { deps } from "@/lib/wiring";

const STOCK_ETFS_MODULE_PATH = "/modules/stock-etfs";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function toErrorResult(error: unknown, fallback: string): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

export interface PreviewResult extends ActionResult {
  preview?: CsvPreview;
  currentMapping?: ColumnMapping;
  namedMappings?: NamedMapping[];
}

export async function previewCsvAction(importType: ImportType, fileText: string): Promise<PreviewResult> {
  try {
    return {
      ok: true,
      preview: previewCsv(fileText),
      currentMapping: getCurrentMapping(deps.csvImportMappingRepo, importType),
      namedMappings: listNamedMappings(deps.csvImportMappingRepo, importType),
    };
  } catch (error) {
    return toErrorResult(error, "Failed to preview CSV.");
  }
}

export async function saveNamedMappingAction(
  name: string,
  importType: ImportType,
  columnMapping: ColumnMapping,
): Promise<ActionResult> {
  try {
    createNamedMapping(deps.csvImportMappingRepo, { name, importType, columnMapping });
  } catch (error) {
    return toErrorResult(error, "Failed to save named mapping.");
  }
  revalidatePath(STOCK_ETFS_MODULE_PATH);
  return { ok: true };
}

export async function deleteNamedMappingAction(id: number): Promise<ActionResult> {
  try {
    deleteNamedMapping(deps.csvImportMappingRepo, id);
  } catch (error) {
    return toErrorResult(error, "Failed to delete named mapping.");
  }
  revalidatePath(STOCK_ETFS_MODULE_PATH);
  return { ok: true };
}

export interface AccountNamesResult extends ActionResult {
  csvAccountNames?: string[];
  accounts?: { id: number; name: string }[];
}

export async function previewAccountNamesAction(
  fileText: string,
  columnMapping: ColumnMapping,
): Promise<AccountNamesResult> {
  try {
    return {
      ok: true,
      csvAccountNames: extractCsvAccountNames(fileText, columnMapping),
      accounts: listAccounts(deps.investmentAccountRepo).map((account) => ({ id: account.id, name: account.name })),
    };
  } catch (error) {
    return toErrorResult(error, "Failed to scan account names.");
  }
}

export interface ExecuteImportResult extends ActionResult {
  summary?: ImportSummary;
}

export async function executeImportAction(
  importType: ImportType,
  fileText: string,
  columnMapping: ColumnMapping,
  accountNameMapping: Record<string, number> = {},
): Promise<ExecuteImportResult> {
  try {
    let summary: ImportSummary;
    if (importType === "Position") {
      summary = importPositionsFromCsv(deps.stockPositionRepo, fileText, columnMapping);
    } else if (importType === "Transaction") {
      summary = importTransactionsFromCsv(deps.stockPositionRepo, fileText, columnMapping);
    } else {
      summary = importPerformanceFromCsv(deps.investmentAccountRepo, fileText, columnMapping, accountNameMapping);
    }

    saveCurrentMapping(deps.csvImportMappingRepo, { importType, columnMapping });
    revalidatePath(STOCK_ETFS_MODULE_PATH);
    return { ok: true, summary };
  } catch (error) {
    return toErrorResult(error, "Failed to import CSV.");
  }
}
