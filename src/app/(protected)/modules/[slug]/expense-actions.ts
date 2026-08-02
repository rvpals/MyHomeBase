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
  applyRulesToExistingTransactions,
  clearAccountImage,
  createAccount,
  createRule,
  createTransaction,
  deleteAccount,
  deleteCategory,
  deleteRule,
  deleteTransaction,
  importExpenseCsv,
  previewPatternMatches,
  setAccountImage,
  updateAccount,
  updateRule,
  updateTransaction,
  upsertCategory,
  type CardImageInput,
  type ExpenseImportSummary,
  type RuleRunSummary,
  type SaveAccountInput,
  type SaveCategoryInput,
  type SaveCategoryRuleInput,
  type SaveTransactionInput,
} from "@/lib/expense";
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
    setAccountImage(deps.expenseRepo, id, { mimeType, base64Data } as CardImageInput);
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

// --- rules ------------------------------------------------------------------

export async function saveRuleAction(
  id: number | undefined,
  input: SaveCategoryRuleInput,
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

export interface RuleRunResult extends ActionResult {
  summary?: RuleRunSummary;
}

export async function applyRulesAction(): Promise<RuleRunResult> {
  try {
    const summary = applyRulesToExistingTransactions(deps.expenseRepo);
    revalidatePath(EXPENSE_MODULE_PATH);
    return { ok: true, summary };
  } catch (error) {
    return toErrorResult(error, "Failed to apply the rules.");
  }
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
