"use server";

import { revalidatePath } from "next/cache";
import {
  createNamedMapping,
  deleteNamedMapping,
  getCurrentMapping,
  listNamedMappings,
  previewCsv,
  resolveAccountNameMapping,
  restrictMapping,
  saveCurrentMapping,
  toAccountNameMapping,
  updateNamedMapping,
  type AccountNameMapping,
  type ColumnMapping,
  type CsvPreview,
  type FieldOptionsMap,
  type ImportSummary,
  type NamedMapping,
} from "@/lib/csv-import";
import {
  extractCsvAccountNames,
  importPerformanceFromCsv,
  listAccounts,
  PERFORMANCE_IMPORT_FIELDS,
} from "@/lib/investment-accounts";
import {
  importPositionsFromCsv,
  importTransactionsFromCsv,
  POSITION_IMPORT_FIELDS,
  TRANSACTION_IMPORT_FIELDS,
} from "@/lib/stock-positions";
import { deps } from "@/lib/wiring";

const STOCK_ETFS_MODULE_PATH = "/modules/stock-etfs";

/**
 * The three import types this module offers — a narrowing of the shared
 * `ImportType`, which also covers Journal and Expense. Naming them here keeps the
 * Stocks importer from being handed a Journal mapping.
 */
export type StockImportType = "Position" | "Transaction" | "Performance";

/** Which target fields each type's importer actually reads. */
const FIELDS_BY_TYPE: Record<StockImportType, readonly { value: string }[]> = {
  Position: POSITION_IMPORT_FIELDS,
  Transaction: TRANSACTION_IMPORT_FIELDS,
  Performance: PERFORMANCE_IMPORT_FIELDS,
};

function allowedFields(importType: StockImportType): string[] {
  return FIELDS_BY_TYPE[importType].map((field) => field.value);
}

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

export async function previewCsvAction(
  importType: StockImportType,
  fileText: string,
): Promise<PreviewResult> {
  try {
    const preview = previewCsv(fileText);
    const allowed = allowedFields(importType);
    return {
      ok: true,
      // Auto-mapping guesses from header text without knowing the import type, so a
      // positions file's "Value" column comes back aimed at a performance-only
      // field. Drop anything this type's importer wouldn't read.
      preview: { ...preview, autoMapping: restrictMapping(preview.autoMapping, allowed) },
      currentMapping: getCurrentMapping(deps.csvImportMappingRepo, importType),
      namedMappings: listNamedMappings(deps.csvImportMappingRepo, importType),
    };
  } catch (error) {
    return toErrorResult(error, "Failed to preview CSV.");
  }
}

/**
 * Creates a named mapping, or overwrites `mappingId` when one is given. One action
 * for both so the view's "Save as new" / "Update selected" buttons don't need two
 * near-identical round trips.
 */
export async function saveNamedMappingAction(
  mappingId: number | undefined,
  name: string,
  importType: StockImportType,
  columnMapping: ColumnMapping,
  fieldOptions: FieldOptionsMap = {},
  /**
   * The account-matching dialog's choices, `csvAccountName -> accountId`. Paired
   * with each account's current *name* here rather than in the view, because
   * only this side can read the accounts — see `toAccountNameMapping`.
   */
  accountNameChoices: Record<string, number> = {},
): Promise<ActionResult> {
  try {
    const accountNameMapping = toAccountNameMapping(
      accountNameChoices,
      listAccounts(deps.investmentAccountRepo),
    );
    if (mappingId === undefined) {
      createNamedMapping(deps.csvImportMappingRepo, {
        name,
        importType,
        columnMapping,
        fieldOptions,
        accountNameMapping,
      });
    } else {
      updateNamedMapping(deps.csvImportMappingRepo, mappingId, {
        name,
        columnMapping,
        fieldOptions,
        accountNameMapping,
      });
    }
  } catch (error) {
    return toErrorResult(error, "Failed to save the mapping.");
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
  /** Matches the applied named mapping already knows, `csvAccountName -> accountId`. */
  remembered?: Record<string, number>;
}

export async function previewAccountNamesAction(
  fileText: string,
  columnMapping: ColumnMapping,
  /** What the loaded named mapping remembered, if one is applied. */
  savedAccountNameMapping: AccountNameMapping = {},
): Promise<AccountNamesResult> {
  try {
    const accounts = listAccounts(deps.investmentAccountRepo);
    return {
      ok: true,
      csvAccountNames: extractCsvAccountNames(fileText, columnMapping),
      accounts: accounts.map((account) => ({ id: account.id, name: account.name })),
      // Resolved here rather than in the view: a saved match can be stale two
      // ways (renamed account, recreated account), and only this side can see
      // the accounts to work out which.
      remembered: resolveAccountNameMapping(savedAccountNameMapping, accounts),
    };
  } catch (error) {
    return toErrorResult(error, "Failed to scan account names.");
  }
}

export interface ExecuteImportResult extends ActionResult {
  summary?: ImportSummary;
}

export async function executeImportAction(
  importType: StockImportType,
  fileText: string,
  columnMapping: ColumnMapping,
  fieldOptions: FieldOptionsMap = {},
  /** Which account a Positions import writes into. 0 = Unassigned. Ignored by the other types. */
  targetAccountId = 0,
  accountNameMapping: Record<string, number> = {},
  /** Row indexes (0-based, over the file's data rows) the user removed from the grid. */
  excludedRowIndexes: number[] = [],
  /**
   * Values set per row in the grid — `rowIndex -> field -> value`. Only Positions
   * offers this today (the per-row Type dropdown); the other importers ignore it.
   */
  rowValueOverrides: Record<number, Record<string, string>> = {},
): Promise<ExecuteImportResult> {
  try {
    let summary: ImportSummary;
    if (importType === "Position") {
      summary = importPositionsFromCsv(deps.stockPositionRepo, fileText, columnMapping, {
        accountId: targetAccountId,
        fieldOptions,
        excludedRowIndexes,
        rowValueOverrides,
      });
    } else if (importType === "Transaction") {
      summary = importTransactionsFromCsv(
        deps.stockPositionRepo,
        fileText,
        columnMapping,
        fieldOptions,
        excludedRowIndexes,
      );
    } else {
      summary = importPerformanceFromCsv(
        deps.investmentAccountRepo,
        fileText,
        columnMapping,
        accountNameMapping,
        fieldOptions,
        excludedRowIndexes,
      );
    }

    // Remembered as this type's default mapping, so the next file of the same kind
    // opens pre-mapped even if it was never saved under a name.
    saveCurrentMapping(deps.csvImportMappingRepo, { importType, columnMapping });
    revalidatePath(STOCK_ETFS_MODULE_PATH);
    return { ok: true, summary };
  } catch (error) {
    return toErrorResult(error, "Failed to import CSV.");
  }
}
