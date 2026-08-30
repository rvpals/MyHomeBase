"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import {
  createNamedMapping,
  deleteNamedMapping,
  listNamedMappings,
  previewCsv,
  updateNamedMapping,
  type ColumnMapping,
  type CsvPreview,
  type FieldOptionsMap,
  type NamedMapping,
} from "@/lib/csv-import";
import {
  EXPENSE_SETTING_KEYS,
  bulkEditTransactions,
  clearAccountImage,
  clearCategoryIcon,
  clearVendorIcon,
  autoPopulateVendorIcon,
  countUnprocessed,
  createAccount,
  createRule,
  createTransaction,
  deleteAccount,
  deleteCategory,
  deleteVendor,
  deleteRule,
  deleteTransaction,
  deleteTransactions,
  importExpenseCsv,
  previewPatternMatches,
  resetProcessedFlags,
  applyRuleToExistingTransactions,
  runCleanupBatch,
  setAccountImage,
  setCategoryIcon,
  setVendorIcon,
  updateAccount,
  updateRule,
  updateTransaction,
  upsertCategory,
  upsertVendor,
  type AutoImportRunSummary,
  type BulkTransactionEditInput,
  type ExpenseImageUploadInput,
  type CleanupBatchResult,
  type ExpenseImportSummary,
  type SaveAccountInput,
  type SaveCategoryInput,
  type SaveVendorInput,
  type SavePostImportRuleInput,
  type VendorIconFetchResult,
  type RuleActionField,
  type SaveTransactionInput,
} from "@/lib/expense";
import { runExpenseAutoImport } from "@/lib/expense/auto-import-runner";
import { getModuleBySlug } from "@/lib/modules";
import { removeModuleSetting, saveModuleSettingsPartial } from "@/lib/module-settings";
import { deps } from "@/lib/wiring";

const EXPENSE_MODULE_PATH = "/modules/expense";
const EXPENSE_IMPORT_TYPE = "Expense" as const;

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function toErrorResult(error: unknown, fallback: string): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

/** The signed-in user's id, recorded as the creator of a transaction. */
async function currentUserId(): Promise<number | undefined> {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  return getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo)?.id;
}

// --- accounts ---------------------------------------------------------------

export async function saveAccountAction(
  id: number | undefined,
  input: SaveAccountInput,
): Promise<ActionResult> {
  try {
    if (id === undefined) createAccount(deps.expenseRepo, input);
    else updateAccount(deps.expenseRepo, id, input);
  } catch (error) {
    return toErrorResult(error, "Failed to save the account.");
  }
  revalidatePath(EXPENSE_MODULE_PATH);
  return { ok: true };
}

/**
 * Stores a card image. The browser sends base64 rather than raw bytes because
 * that survives server-action serialization cleanly; the use-case decodes it and
 * enforces the type and size limits.
 */
export async function saveAccountImageAction(
  id: number,
  mimeType: string,
  base64Data: string,
): Promise<ActionResult> {
  try {
    setAccountImage(deps.expenseRepo, id, { mimeType, base64Data } as ExpenseImageUploadInput);
  } catch (error) {
    return toErrorResult(error, "Failed to save the card image.");
  }
  revalidatePath(EXPENSE_MODULE_PATH);
  return { ok: true };
}

export async function clearAccountImageAction(id: number): Promise<ActionResult> {
  try {
    clearAccountImage(deps.expenseRepo, id);
  } catch (error) {
    return toErrorResult(error, "Failed to remove the card image.");
  }
  revalidatePath(EXPENSE_MODULE_PATH);
  return { ok: true };
}

export async function deleteAccountAction(id: number): Promise<ActionResult> {
  try {
    deleteAccount(deps.expenseRepo, id);
  } catch (error) {
    return toErrorResult(error, "Failed to delete the account.");
  }
  revalidatePath(EXPENSE_MODULE_PATH);
  return { ok: true };
}

// --- categories -------------------------------------------------------------

export async function saveCategoryAction(input: SaveCategoryInput): Promise<ActionResult> {
  try {
    upsertCategory(deps.expenseRepo, input);
  } catch (error) {
    return toErrorResult(error, "Failed to save the category.");
  }
  revalidatePath(EXPENSE_MODULE_PATH);
  return { ok: true };
}

export async function deleteCategoryAction(name: string): Promise<ActionResult> {
  try {
    deleteCategory(deps.expenseRepo, name);
  } catch (error) {
    return toErrorResult(error, "Failed to delete the category.");
  }
  revalidatePath(EXPENSE_MODULE_PATH);
  return { ok: true };
}

/**
 * Stores a category's icon. Base64 rather than raw bytes for the same reason as
 * the card image: it survives server-action serialization cleanly, and the
 * use-case decodes it and enforces the type and size limits.
 */
export async function saveCategoryIconAction(
  name: string,
  mimeType: string,
  base64Data: string,
): Promise<ActionResult> {
  try {
    setCategoryIcon(deps.expenseRepo, name, {
      mimeType,
      base64Data,
    } as ExpenseImageUploadInput);
  } catch (error) {
    return toErrorResult(error, "Failed to save the category icon.");
  }
  revalidatePath(EXPENSE_MODULE_PATH);
  return { ok: true };
}

export async function clearCategoryIconAction(name: string): Promise<ActionResult> {
  try {
    clearCategoryIcon(deps.expenseRepo, name);
  } catch (error) {
    return toErrorResult(error, "Failed to remove the category icon.");
  }
  revalidatePath(EXPENSE_MODULE_PATH);
  return { ok: true };
}

// --- vendors ----------------------------------------------------------------
//
// A vendor usually starts out derived from a statement description with no row
// of its own, so these are the actions that first persist one. Saving a vendor
// that is already saved just updates its description.

export async function saveVendorAction(input: SaveVendorInput): Promise<ActionResult> {
  try {
    upsertVendor(deps.expenseRepo, input);
  } catch (error) {
    return toErrorResult(error, "Failed to save the vendor.");
  }
  revalidatePath(EXPENSE_MODULE_PATH);
  return { ok: true };
}

export async function deleteVendorAction(name: string): Promise<ActionResult> {
  try {
    deleteVendor(deps.expenseRepo, name);
  } catch (error) {
    return toErrorResult(error, "Failed to delete the vendor.");
  }
  revalidatePath(EXPENSE_MODULE_PATH);
  return { ok: true };
}

/**
 * Stores a vendor's icon, creating the vendor row when it doesn't exist yet —
 * see `setVendorIcon`, which owns that behaviour. Base64 rather than raw bytes
 * for the same reason as the card image: it survives server-action
 * serialization cleanly, and the use-case enforces the type and size limits.
 */
export async function saveVendorIconAction(
  name: string,
  mimeType: string,
  base64Data: string,
): Promise<ActionResult> {
  try {
    setVendorIcon(deps.expenseRepo, name, {
      mimeType,
      base64Data,
    } as ExpenseImageUploadInput);
  } catch (error) {
    return toErrorResult(error, "Failed to save the vendor icon.");
  }
  revalidatePath(EXPENSE_MODULE_PATH);
  return { ok: true };
}

/** One auto-populate batch's worth of results, in the order asked for. */
export interface AutoPopulateVendorIconsResult extends ActionResult {
  results?: VendorIconFetchResult[];
}

/**
 * Fetches logos for a batch of vendors. The client calls this a few names at a
 * time so the progress bar can move and the run can be stopped part way — a
 * single call over forty vendors could not report anything until it finished,
 * and would sit on forty sequential HTTP requests.
 *
 * The batch runs its lookups concurrently: they are independent, network-bound,
 * and against a service that is fine with a handful at once. One vendor
 * throwing does not take the batch down, because the use case catches per
 * vendor and reports `failed`.
 */
export async function autoPopulateVendorIconsAction(
  names: string[],
): Promise<AutoPopulateVendorIconsResult> {
  try {
    const results = await Promise.all(
      names.map((name) => autoPopulateVendorIcon(deps.expenseRepo, deps.vendorLogoClient, name)),
    );
    revalidatePath(EXPENSE_MODULE_PATH);
    return { ok: true, results };
  } catch (error) {
    return toErrorResult(error, "Failed to auto-populate the vendor icons.");
  }
}

export async function clearVendorIconAction(name: string): Promise<ActionResult> {
  try {
    clearVendorIcon(deps.expenseRepo, name);
  } catch (error) {
    return toErrorResult(error, "Failed to remove the vendor icon.");
  }
  revalidatePath(EXPENSE_MODULE_PATH);
  return { ok: true };
}

// --- transactions -----------------------------------------------------------

export async function saveTransactionAction(
  id: number | undefined,
  input: SaveTransactionInput,
): Promise<ActionResult> {
  try {
    if (id === undefined) {
      const userId = await currentUserId();
      if (userId === undefined) return { ok: false, error: "You must be signed in." };
      createTransaction(deps.expenseRepo, input, userId);
    } else {
      updateTransaction(deps.expenseRepo, id, input);
    }
  } catch (error) {
    return toErrorResult(error, "Failed to save the transaction.");
  }
  revalidatePath(EXPENSE_MODULE_PATH);
  return { ok: true };
}

export async function deleteTransactionAction(id: number): Promise<ActionResult> {
  try {
    deleteTransaction(deps.expenseRepo, id);
  } catch (error) {
    return toErrorResult(error, "Failed to delete the transaction.");
  }
  revalidatePath(EXPENSE_MODULE_PATH);
  return { ok: true };
}

/** How many rows a bulk operation touched, so the view can report it. */
export interface BulkActionResult extends ActionResult {
  count?: number;
}

export async function deleteTransactionsAction(ids: number[]): Promise<BulkActionResult> {
  try {
    const count = deleteTransactions(deps.expenseRepo, ids);
    revalidatePath(EXPENSE_MODULE_PATH);
    return { ok: true, count };
  } catch (error) {
    return toErrorResult(error, "Failed to delete the transactions.");
  }
}

export async function bulkEditTransactionsAction(
  ids: number[],
  changes: BulkTransactionEditInput,
): Promise<BulkActionResult> {
  try {
    const count = bulkEditTransactions(deps.expenseRepo, ids, changes);
    revalidatePath(EXPENSE_MODULE_PATH);
    return { ok: true, count };
  } catch (error) {
    return toErrorResult(error, "Failed to apply the changes.");
  }
}

// --- rules ------------------------------------------------------------------

export async function saveRuleAction(
  id: number | undefined,
  input: SavePostImportRuleInput,
): Promise<ActionResult> {
  try {
    if (id === undefined) createRule(deps.expenseRepo, input);
    else updateRule(deps.expenseRepo, id, input);
  } catch (error) {
    return toErrorResult(error, "Failed to save the rule.");
  }
  revalidatePath(EXPENSE_MODULE_PATH);
  return { ok: true };
}

export async function deleteRuleAction(id: number): Promise<ActionResult> {
  try {
    deleteRule(deps.expenseRepo, id);
  } catch (error) {
    return toErrorResult(error, "Failed to delete the rule.");
  }
  revalidatePath(EXPENSE_MODULE_PATH);
  return { ok: true };
}

/**
 * Saves the watched folder — and *only* the watched folder.
 *
 * Two deliberate narrowings from what this used to do, both forced by the master
 * switch and the interval moving to Administration -> Background Tasks:
 *
 *  1. It takes a path, not the whole `ExpenseSettings`. This screen no longer renders
 *     the other two fields, so accepting them would let it write values it never
 *     showed the user.
 *  2. `saveModuleSettingsPartial`, not `saveModuleSettings`. The wholesale save
 *     deletes every row for the module and reinserts only what it is handed, so
 *     saving a folder here would silently wipe the switch and interval an admin had
 *     just set on the other screen.
 */
export async function saveExpenseFolderAction(autoImportPath: string): Promise<ActionResult> {
  try {
    const expenseModule = getModuleBySlug(deps.moduleRepo, "expense");
    if (!expenseModule) return { ok: false, error: "Expense module not found." };

    const trimmed = autoImportPath.trim();
    // Module-setting values must be non-empty, so clearing the folder deletes the row
    // rather than writing "". `resolveExpenseSettings` reads a missing row as "" too,
    // so both spellings mean the same thing to every reader.
    if (trimmed === "") {
      removeModuleSetting(
        deps.moduleSettingsRepo,
        expenseModule.id,
        EXPENSE_SETTING_KEYS.autoImportPath,
      );
    } else {
      saveModuleSettingsPartial(deps.moduleSettingsRepo, expenseModule.id, [
        { key: EXPENSE_SETTING_KEYS.autoImportPath, value: trimmed },
      ]);
    }
  } catch (error) {
    return toErrorResult(error, "Failed to save the folder.");
  }
  revalidatePath(EXPENSE_MODULE_PATH);
  revalidatePath("/admin/background-tasks");
  return { ok: true };
}

export interface AutoImportResult extends ActionResult {
  summary?: AutoImportRunSummary;
}

/**
 * Runs the auto-import immediately, rather than waiting for the next tick.
 *
 * `force`, so the master switch and the interval don't gate it: this is an explicit
 * request, and testing a folder before arming the service is exactly what it's for.
 */
export async function runAutoImportNowAction(): Promise<AutoImportResult> {
  try {
    const summary = runExpenseAutoImport({ force: true });
    revalidatePath(EXPENSE_MODULE_PATH);
    return { ok: true, summary };
  } catch (error) {
    return toErrorResult(error, "Failed to run the auto-import.");
  }
}

export interface CleanupBatchActionResult extends ActionResult {
  result?: CleanupBatchResult;
}

/**
 * Processes one batch of unprocessed transactions. The client calls this in a
 * loop so it can show progress and a live log — a single long call couldn't
 * report anything until it finished.
 */
export async function runCleanupBatchAction(batchSize: number): Promise<CleanupBatchActionResult> {
  try {
    return { ok: true, result: runCleanupBatch(deps.expenseRepo, batchSize) };
  } catch (error) {
    return toErrorResult(error, "Failed to run the clean-up.");
  }
}

export interface UnprocessedCountResult extends ActionResult {
  count?: number;
}

/** The size of the queue, read before a run so the progress bar has a total. */
export async function countUnprocessedAction(): Promise<UnprocessedCountResult> {
  try {
    return { ok: true, count: countUnprocessed(deps.expenseRepo) };
  } catch (error) {
    return toErrorResult(error, "Failed to count unprocessed transactions.");
  }
}

/** Re-queues everything, so a newly added rule can reach older transactions. */
export async function resetProcessedAction(): Promise<UnprocessedCountResult> {
  try {
    const count = resetProcessedFlags(deps.expenseRepo);
    revalidatePath(EXPENSE_MODULE_PATH);
    return { ok: true, count };
  } catch (error) {
    return toErrorResult(error, "Failed to reset the processed flags.");
  }
}

export interface ForcedRuleActionResult extends ActionResult {
  matchedCount?: number;
  changedCount?: number;
  fieldsChanged?: RuleActionField[];
}

/**
 * Re-runs one rule over every transaction it matches, overwriting existing
 * values — the per-rule "Update Trans" button. Unlike the clean-up this ignores
 * the processed queue entirely; the client warns before calling it.
 */
export async function applyRuleToExistingAction(
  ruleId: number,
): Promise<ForcedRuleActionResult> {
  try {
    const result = applyRuleToExistingTransactions(deps.expenseRepo, ruleId);
    revalidatePath(EXPENSE_MODULE_PATH);
    return { ok: true, ...result };
  } catch (error) {
    return toErrorResult(error, "Failed to update the transactions.");
  }
}

/** Called once at the end of a run so the page picks up every change. */
export async function refreshExpenseViewAction(): Promise<ActionResult> {
  revalidatePath(EXPENSE_MODULE_PATH);
  return { ok: true };
}

export interface PatternPreviewResult extends ActionResult {
  matchCount?: number;
  samples?: string[];
}

/** Backs the live "N transactions match" hint while a rule is being written. */
export async function previewPatternAction(pattern: string): Promise<PatternPreviewResult> {
  try {
    if (pattern.trim() === "") return { ok: true, matchCount: 0, samples: [] };
    const preview = previewPatternMatches(deps.expenseRepo, pattern);
    return { ok: true, ...preview };
  } catch (error) {
    return toErrorResult(error, "Failed to preview the pattern.");
  }
}

// --- CSV import -------------------------------------------------------------

export interface ExpensePreviewResult extends ActionResult {
  preview?: CsvPreview;
  namedMappings?: NamedMapping[];
}

export async function previewExpenseCsvAction(fileText: string): Promise<ExpensePreviewResult> {
  try {
    return {
      ok: true,
      preview: previewCsv(fileText),
      namedMappings: listNamedMappings(deps.csvImportMappingRepo, EXPENSE_IMPORT_TYPE),
    };
  } catch (error) {
    return toErrorResult(error, "Failed to preview the CSV.");
  }
}

export async function saveExpenseMappingAction(
  id: number | undefined,
  name: string,
  columnMapping: ColumnMapping,
  fieldOptions: FieldOptionsMap,
): Promise<ActionResult> {
  try {
    if (id === undefined) {
      createNamedMapping(deps.csvImportMappingRepo, {
        name,
        importType: EXPENSE_IMPORT_TYPE,
        columnMapping,
        fieldOptions,
      });
    } else {
      updateNamedMapping(deps.csvImportMappingRepo, id, { name, columnMapping, fieldOptions });
    }
  } catch (error) {
    return toErrorResult(error, "Failed to save the mapping.");
  }
  revalidatePath(EXPENSE_MODULE_PATH);
  return { ok: true };
}

export async function deleteExpenseMappingAction(id: number): Promise<ActionResult> {
  try {
    deleteNamedMapping(deps.csvImportMappingRepo, id);
  } catch (error) {
    return toErrorResult(error, "Failed to delete the mapping.");
  }
  revalidatePath(EXPENSE_MODULE_PATH);
  return { ok: true };
}

export interface ExpenseImportResult extends ActionResult {
  summary?: ExpenseImportSummary;
}

export async function runExpenseImportAction(
  fileText: string,
  columnMapping: ColumnMapping,
  fieldOptions: FieldOptionsMap,
  options: { transactionAccountId: number; invertAmounts: boolean; skipDuplicates: boolean; applyRules: boolean },
): Promise<ExpenseImportResult> {
  try {
    const userId = await currentUserId();
    if (userId === undefined) return { ok: false, error: "You must be signed in." };

    const summary = importExpenseCsv(
      deps.expenseRepo,
      fileText,
      columnMapping,
      fieldOptions,
      options,
      userId,
    );
    revalidatePath(EXPENSE_MODULE_PATH);
    return { ok: true, summary };
  } catch (error) {
    return toErrorResult(error, "Failed to import the CSV.");
  }
}
