import type { ExpenseRepository, TransactionFilter } from "./ports";
import { matchesPattern, planRuleApplication } from "./rules";
import {
  MAX_CARD_IMAGE_BYTES,
  cardImageSchema,
  saveAccountSchema,
  saveCategoryRuleSchema,
  saveCategorySchema,
  saveTransactionSchema,
} from "./schema";
import type {
  CardImageInput,
  SaveAccountInput,
  SaveCategoryInput,
  SaveCategoryRuleInput,
  SaveTransactionInput,
} from "./schema";
import type {
  CardImage,
  CategoryRule,
  CategoryTotal,
  CreditCardAccount,
  ExpenseCategory,
  ExpenseTransaction,
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

export function listRules(repo: ExpenseRepository): CategoryRule[] {
  return repo.listRules();
}

export function createRule(
  repo: ExpenseRepository,
  input: SaveCategoryRuleInput,
): CategoryRule {
  const validated = saveCategoryRuleSchema.parse(input);
  repo.registerCategoriesIfMissing([validated.categoryName]);
  return repo.createRule(validated);
}

export function updateRule(
  repo: ExpenseRepository,
  id: number,
  input: SaveCategoryRuleInput,
): CategoryRule {
  if (!repo.getRuleById(id)) throw new Error(`No rule with id ${id}.`);
  const validated = saveCategoryRuleSchema.parse(input);
  repo.registerCategoriesIfMissing([validated.categoryName]);
  return repo.updateRule(id, validated);
}

export function deleteRule(repo: ExpenseRepository, id: number): void {
  repo.deleteRule(id);
}

export interface RuleRunSummary {
  /** How many transactions were given a category. */
  categorisedCount: number;
  /** How many were looked at (uncategorised ones only). */
  examinedCount: number;
  /** Per-rule tally, so you can see which patterns are earning their keep. */
  byRule: { ruleId: number; pattern: string; categoryName: string; count: number }[];
}

/**
 * Runs the enabled rules over transactions that have no category yet, and
 * returns what changed. Already-categorised rows are left alone, so this is
 * safe to run repeatedly and after adding a rule it backfills older rows.
 */
export function applyRulesToExistingTransactions(
  repo: ExpenseRepository,
  filter?: TransactionFilter,
): RuleRunSummary {
  const rules = repo.listRules();
  const transactions = repo.listTransactions(filter);
  const tally = new Map<number, { pattern: string; categoryName: string; count: number }>();

  let categorisedCount = 0;
  let examinedCount = 0;

  for (const transaction of transactions) {
    if (transaction.categoryName.trim() !== "") continue;
    examinedCount += 1;

    const plan = planRuleApplication(transaction, rules);
    if (!plan) continue;

    repo.setTransactionCategoryAndStatus(transaction.id, plan.categoryName, plan.status);
    categorisedCount += 1;

    const existing = tally.get(plan.rule.id);
    if (existing) existing.count += 1;
    else
      tally.set(plan.rule.id, {
        pattern: plan.rule.pattern,
        categoryName: plan.categoryName,
        count: 1,
      });
  }

  return {
    categorisedCount,
    examinedCount,
    byRule: [...tally.entries()].map(([ruleId, entry]) => ({ ruleId, ...entry })),
  };
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
