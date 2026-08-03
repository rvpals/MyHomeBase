import type { ExpenseRepository, TransactionFilter } from "./ports";
import { matchesPattern, planRuleApplication } from "./rules";
import {
  MAX_CARD_IMAGE_BYTES,
  MAX_CATEGORY_ICON_BYTES,
  bulkTransactionEditSchema,
  expenseImageUploadSchema,
  saveAccountSchema,
  saveCategorySchema,
  savePostImportRuleSchema,
  saveTransactionSchema,
  transactionIdsSchema,
} from "./schema";
import type {
  BulkTransactionEditInput,
  ExpenseImageUploadInput,
  PostImportRuleWriteData,
  SaveAccountInput,
  SaveCategoryInput,
  SavePostImportRuleInput,
  SaveTransactionInput,
} from "./schema";
import type {
  CardImage,
  CategoryIcon,
  CategoryTotal,
  CreditCardAccount,
  ExpenseCategory,
  ExpenseTransaction,
  PostImportRule,
  RuleActionField,
} from "./types";

/**
 * Decodes a browser-supplied base64 upload into bytes, refusing anything that
 * isn't an allowed image type or that busts the caller's size cap. Shared by card
 * art and category icons so both get the same guarantees however they're called
 * (web, CLI, test) — the cap is a parameter because the two differ there.
 */
function decodeImageUpload(
  input: ExpenseImageUploadInput,
  maxBytes: number,
): { data: Buffer; mimeType: string } {
  const { mimeType, base64Data } = expenseImageUploadSchema.parse(input);

  const data = Buffer.from(base64Data, "base64");
  if (data.length === 0) throw new Error("The image could not be read.");
  if (data.length > maxBytes) {
    throw new Error(`Image is too large — keep it under ${Math.round(maxBytes / 1024)} KB.`);
  }

  return { data, mimeType };
}

// --- Credit-card accounts ---------------------------------------------------

export function listAccounts(repo: ExpenseRepository): CreditCardAccount[] {
  return repo.listAccounts();
}

export function createAccount(
  repo: ExpenseRepository,
  input: SaveAccountInput,
): CreditCardAccount {
  return repo.createAccount(saveAccountSchema.parse(input));
}

export function updateAccount(
  repo: ExpenseRepository,
  id: number,
  input: SaveAccountInput,
): CreditCardAccount {
  if (!repo.getAccountById(id)) throw new Error(`No credit-card account with id ${id}.`);
  return repo.updateAccount(id, saveAccountSchema.parse(input));
}

/**
 * Deletes a card, but refuses while transactions still point at it — silently
 * orphaning them would leave rows that can't be traced back to a statement.
 */
export function deleteAccount(repo: ExpenseRepository, id: number): void {
  const inUse = repo.countTransactionsForAccount(id);
  if (inUse > 0) {
    throw new Error(
      `This account still has ${inUse} transaction(s). Delete or reassign them before removing it.`,
    );
  }
  repo.deleteAccount(id);
}

/**
 * Stores a small image for a card. The type allowlist and size cap are enforced
 * here rather than in the UI, so the limits hold however the use-case is called
 * (web, CLI, test).
 */
export function setAccountImage(
  repo: ExpenseRepository,
  id: number,
  input: ExpenseImageUploadInput,
): void {
  if (!repo.getAccountById(id)) throw new Error(`No credit-card account with id ${id}.`);
  repo.setAccountImage(id, decodeImageUpload(input, MAX_CARD_IMAGE_BYTES));
}

/** Removes a card's image, leaving the account itself untouched. */
export function clearAccountImage(repo: ExpenseRepository, id: number): void {
  if (!repo.getAccountById(id)) throw new Error(`No credit-card account with id ${id}.`);
  repo.setAccountImage(id, undefined);
}

/** Used only by the image-serving route — never by anything rendering a list. */
export function getAccountImage(repo: ExpenseRepository, id: number): CardImage | undefined {
  return repo.getAccountImage(id);
}

// --- Categories -------------------------------------------------------------

export function listCategories(repo: ExpenseRepository): ExpenseCategory[] {
  return repo.listCategories();
}

export function upsertCategory(
  repo: ExpenseRepository,
  input: SaveCategoryInput,
): ExpenseCategory {
  return repo.upsertCategory(saveCategorySchema.parse(input));
}

/** Removes the category and clears it from every transaction that used it. */
export function deleteCategory(repo: ExpenseRepository, name: string): void {
  repo.deleteCategory(name);
}

/**
 * Stores the icon shown beside a category in the pickers and the grid. The
 * category must already exist — creating one as a side effect of an upload would
 * let a typo add a category nobody asked for.
 */
export function setCategoryIcon(
  repo: ExpenseRepository,
  name: string,
  input: ExpenseImageUploadInput,
): void {
  if (!repo.getCategoryByName(name)) throw new Error(`No category named "${name}".`);
  repo.setCategoryIcon(name, decodeImageUpload(input, MAX_CATEGORY_ICON_BYTES));
}

/** Removes a category's icon, leaving the category itself untouched. */
export function clearCategoryIcon(repo: ExpenseRepository, name: string): void {
  if (!repo.getCategoryByName(name)) throw new Error(`No category named "${name}".`);
  repo.setCategoryIcon(name, undefined);
}

/** Used only by the icon-serving route — never by anything rendering a list. */
export function getCategoryIcon(
  repo: ExpenseRepository,
  name: string,
): CategoryIcon | undefined {
  return repo.getCategoryIcon(name);
}

// --- Transactions -----------------------------------------------------------

export function listTransactions(
  repo: ExpenseRepository,
  filter?: TransactionFilter,
): ExpenseTransaction[] {
  return repo.listTransactions(filter);
}

export function getTransaction(
  repo: ExpenseRepository,
  id: number,
): ExpenseTransaction | undefined {
  return repo.getTransactionById(id);
}

/**
 * Records a transaction. The account must exist, and a category named here is
 * registered automatically so the managed list never falls behind what's in use.
 */
export function createTransaction(
  repo: ExpenseRepository,
  input: SaveTransactionInput,
  createdByUserId: number,
): ExpenseTransaction {
  const validated = saveTransactionSchema.parse(input);
  if (!repo.getAccountById(validated.transactionAccountId)) {
    throw new Error(`No credit-card account with id ${validated.transactionAccountId}.`);
  }
  if (validated.categoryName !== "") repo.registerCategoriesIfMissing([validated.categoryName]);
  return repo.createTransaction(validated, createdByUserId);
}

export function updateTransaction(
  repo: ExpenseRepository,
  id: number,
  input: SaveTransactionInput,
): ExpenseTransaction {
  if (!repo.getTransactionById(id)) throw new Error(`No transaction with id ${id}.`);
  const validated = saveTransactionSchema.parse(input);
  if (!repo.getAccountById(validated.transactionAccountId)) {
    throw new Error(`No credit-card account with id ${validated.transactionAccountId}.`);
  }
  if (validated.categoryName !== "") repo.registerCategoriesIfMissing([validated.categoryName]);
  return repo.updateTransaction(id, validated);
}

export function deleteTransaction(repo: ExpenseRepository, id: number): void {
  repo.deleteTransaction(id);
}

/**
 * Deletes a whole selection at once, returning how many rows went. Ids that no
 * longer exist are simply not counted — a stale selection (someone else deleted
 * the row first) shouldn't fail the rest of the batch.
 */
export function deleteTransactions(repo: ExpenseRepository, ids: number[]): number {
  return repo.deleteTransactions(dedupe(transactionIdsSchema.parse(ids)));
}

/**
 * Applies the same value to the same field across a selection.
 *
 * Only the fields named in `changes` are written; everything else on each row is
 * left alone, so this can't clobber the parts of a transaction the caller wasn't
 * editing. Which fields are eligible is decided by the schema (notably *not*
 * date or amount), so the rule holds for the CLI as much as the web app.
 *
 * Returns the number of rows changed.
 */
export function bulkEditTransactions(
  repo: ExpenseRepository,
  ids: number[],
  changes: BulkTransactionEditInput,
): number {
  const validatedIds = dedupe(transactionIdsSchema.parse(ids));
  const validated = bulkTransactionEditSchema.parse(changes);

  // Same guarantees a single-row update gives: the target card must exist, and a
  // category typed in here joins the managed list.
  if (
    validated.transactionAccountId !== undefined &&
    !repo.getAccountById(validated.transactionAccountId)
  ) {
    throw new Error(`No credit-card account with id ${validated.transactionAccountId}.`);
  }
  if (validated.categoryName !== undefined && validated.categoryName !== "") {
    repo.registerCategoriesIfMissing([validated.categoryName]);
  }

  return repo.bulkUpdateTransactions(validatedIds, validated);
}

/** A selection can repeat an id; the SQL `IN (…)` shouldn't. */
function dedupe(ids: number[]): number[] {
  return [...new Set(ids)];
}

// --- Rules ------------------------------------------------------------------

export function listRules(repo: ExpenseRepository): PostImportRule[] {
  return repo.listRules();
}

/** Any category a rule assigns is registered, so the managed list stays complete. */
function registerRuleCategories(repo: ExpenseRepository, input: PostImportRuleWriteData): void {
  const categories = input.actions
    .filter((action) => action.fieldName === "categoryName")
    .map((action) => action.fieldValue);
  if (categories.length > 0) repo.registerCategoriesIfMissing(categories);
}

export function createRule(
  repo: ExpenseRepository,
  input: SavePostImportRuleInput,
): PostImportRule {
  const validated = savePostImportRuleSchema.parse(input);
  registerRuleCategories(repo, validated);
  return repo.createRule(validated);
}

export function updateRule(
  repo: ExpenseRepository,
  id: number,
  input: SavePostImportRuleInput,
): PostImportRule {
  if (!repo.getRuleById(id)) throw new Error(`No rule with id ${id}.`);
  const validated = savePostImportRuleSchema.parse(input);
  registerRuleCategories(repo, validated);
  return repo.updateRule(id, validated);
}

export function deleteRule(repo: ExpenseRepository, id: number): void {
  repo.deleteRule(id);
}

/** One line of the clean-up run log, shaped for display. */
export interface CleanupLogEntry {
  transactionId: number;
  description: string;
  /** The rule that matched, or undefined when nothing did. */
  pattern?: string;
  /** e.g. [{ fieldName: "vendor", value: "TGI Friday" }] — empty if nothing changed. */
  changes: { fieldName: RuleActionField; value: string }[];
}

export interface CleanupBatchResult {
  /** How many rows this batch handled. */
  processedCount: number;
  /** How many of those a rule actually changed. */
  changedCount: number;
  /** Still queued after this batch — drives the progress bar. */
  remainingCount: number;
  entries: CleanupLogEntry[];
}

export const DEFAULT_CLEANUP_BATCH_SIZE = 25;

/**
 * Runs the post-import rules over the next batch of unprocessed transactions.
 *
 * Batching (rather than one long call) is what makes a progress bar and a live
 * log possible over ordinary server actions, and makes the run resumable: the
 * `processed` flag *is* the queue, so stopping half way just leaves the rest.
 *
 * Every row in the batch is marked processed, including ones no rule matched —
 * they've been through the rules, so they don't need looking at again. Use
 * `resetProcessedFlags` after adding a rule to sweep the back catalogue.
 */
export function runCleanupBatch(
  repo: ExpenseRepository,
  batchSize = DEFAULT_CLEANUP_BATCH_SIZE,
): CleanupBatchResult {
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error(`runCleanupBatch: batchSize must be a positive integer, got ${batchSize}.`);
  }

  const rules = repo.listRules();
  const batch = repo.listUnprocessed(batchSize);
  const entries: CleanupLogEntry[] = [];
  let changedCount = 0;

  for (const transaction of batch) {
    const plan = planRuleApplication(transaction, rules);
    const assignments: Partial<Record<RuleActionField, string>> = {};

    for (const assignment of plan?.assignments ?? []) {
      assignments[assignment.fieldName] = assignment.value;
    }
    if (Object.keys(assignments).length > 0) changedCount += 1;

    // Also marks the row processed, in the same statement.
    repo.applyProcessingResult(transaction.id, assignments);

    // A category a rule introduced must exist in the managed list.
    if (assignments.categoryName) repo.registerCategoriesIfMissing([assignments.categoryName]);

    entries.push({
      transactionId: transaction.id,
      description: transaction.transactionDescription,
      pattern: plan?.rule.pattern,
      changes: (plan?.assignments ?? []).map((assignment) => ({
        fieldName: assignment.fieldName,
        value: assignment.value,
      })),
    });
  }

  return {
    processedCount: batch.length,
    changedCount,
    remainingCount: repo.countUnprocessed(),
    entries,
  };
}

/** How many transactions are still waiting to be processed. */
export function countUnprocessed(repo: ExpenseRepository): number {
  return repo.countUnprocessed();
}

/**
 * Clears every processed flag so the rules run over the whole history again —
 * what you want after adding a rule that should reach older transactions.
 * Existing field values are still never overwritten.
 */
export function resetProcessedFlags(repo: ExpenseRepository): number {
  return repo.resetProcessedFlags();
}

/**
 * Previews which existing descriptions a pattern would match, without changing
 * anything — this backs the "N transactions match" hint on the rule editor.
 */
export function previewPatternMatches(
  repo: ExpenseRepository,
  pattern: string,
  limit = 5,
): { matchCount: number; samples: string[] } {
  const descriptions = repo.listTransactions().map((t) => t.transactionDescription);
  const matched = descriptions.filter((description) => matchesPattern(description, pattern));
  return { matchCount: matched.length, samples: matched.slice(0, limit) };
}

// --- Reporting --------------------------------------------------------------

export function totalsByCategory(
  repo: ExpenseRepository,
  filter?: TransactionFilter,
): CategoryTotal[] {
  return repo.totalsByCategory(filter);
}
