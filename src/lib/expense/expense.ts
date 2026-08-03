import type { ExpenseRepository, TransactionFilter } from "./ports";
import { matchesPattern, planRuleApplication } from "./rules";
import {
  MAX_CARD_IMAGE_BYTES,
  cardImageSchema,
  saveAccountSchema,
  saveCategorySchema,
  savePostImportRuleSchema,
  saveTransactionSchema,
} from "./schema";
import type {
  CardImageInput,
  PostImportRuleWriteData,
  SaveAccountInput,
  SaveCategoryInput,
  SavePostImportRuleInput,
  SaveTransactionInput,
} from "./schema";
import type {
  CardImage,
  CategoryTotal,
  CreditCardAccount,
  ExpenseCategory,
  ExpenseTransaction,
  PostImportRule,
  RuleActionField,
} from "./types";

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
 * Stores a small image for a card. Decodes the browser-supplied base64, then
 * enforces the type allowlist and size cap here rather than in the UI, so the
 * limits hold however the use-case is called (web, CLI, test).
 */
export function setAccountImage(
  repo: ExpenseRepository,
  id: number,
  input: CardImageInput,
): void {
  if (!repo.getAccountById(id)) throw new Error(`No credit-card account with id ${id}.`);
  const { mimeType, base64Data } = cardImageSchema.parse(input);

  const data = Buffer.from(base64Data, "base64");
  if (data.length === 0) throw new Error("The image could not be read.");
  if (data.length > MAX_CARD_IMAGE_BYTES) {
    const limitKb = Math.round(MAX_CARD_IMAGE_BYTES / 1024);
    throw new Error(`Image is too large — keep it under ${limitKb} KB.`);
  }

  repo.setAccountImage(id, { data, mimeType });
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
