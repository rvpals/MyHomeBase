import { decodeImageUpload } from "@/lib/shared/image-upload";
import type { ExpenseRepository, TransactionFilter } from "./ports";
import { matchesPattern, planForcedRuleApplication, planRuleApplication } from "./rules";
import type { VendorLogoClient } from "../vendor-logos/ports";
import {
  MAX_CARD_IMAGE_BYTES,
  MAX_CATEGORY_ICON_BYTES,
  MAX_VENDOR_ICON_BYTES,
  bulkTransactionEditSchema,
  saveAccountSchema,
  saveCategorySchema,
  saveVendorSchema,
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
  SaveVendorInput,
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
  ExpenseVendor,
  PostImportRule,
  RuleActionField,
  VendorIcon,
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

// --- Vendors ----------------------------------------------------------------
//
// Only the *saved* side lives here. The spend rollups (`vendorTotals`) stay pure
// and derived from the transactions, so every screen keeps working for a vendor
// that has no row at all.

export function listVendors(repo: ExpenseRepository): ExpenseVendor[] {
  return repo.listVendors();
}

export function upsertVendor(repo: ExpenseRepository, input: SaveVendorInput): ExpenseVendor {
  return repo.upsertVendor(saveVendorSchema.parse(input));
}

/**
 * Removes the vendor's saved description and icon. The transactions keep their
 * `vendor` text, so the name comes straight back as a derived-only vendor — this
 * clears the decoration, it does not erase history.
 */
export function deleteVendor(repo: ExpenseRepository, name: string): void {
  repo.deleteVendor(name);
}

/**
 * Stores the icon shown beside a vendor everywhere it appears.
 *
 * Unlike a category icon this **creates the vendor row when it's missing**, and
 * that asymmetry is deliberate: most vendors start life derived from a statement
 * description and have never been saved, so requiring a prior save would mean
 * every icon upload needed two steps. The name still has to be non-blank, which
 * `saveVendorSchema` enforces.
 */
export function setVendorIcon(
  repo: ExpenseRepository,
  name: string,
  input: ExpenseImageUploadInput,
): void {
  const vendor = repo.getVendorByName(name) ?? upsertVendor(repo, { name });
  repo.setVendorIcon(vendor.name, decodeImageUpload(input, MAX_VENDOR_ICON_BYTES));
}

/** Removes a vendor's icon, leaving the vendor row itself untouched. */
export function clearVendorIcon(repo: ExpenseRepository, name: string): void {
  if (!repo.getVendorByName(name)) throw new Error(`No vendor named "${name}".`);
  repo.setVendorIcon(name, undefined);
}

/** Used only by the icon-serving route — never by anything rendering a list. */
export function getVendorIcon(repo: ExpenseRepository, name: string): VendorIcon | undefined {
  return repo.getVendorIcon(name);
}

/** What one vendor's auto-populate attempt did. */
export type VendorIconFetchOutcome =
  /** A logo was found and stored. */
  | "set"
  /** The vendor already had an icon, so it was left alone. */
  | "already-has-icon"
  /** The service has no logo for this vendor — the ordinary miss. */
  | "no-logo-found"
  /** The lookup itself broke: a timeout, a DNS failure, the service down. */
  | "failed";

export interface VendorIconFetchResult {
  name: string;
  outcome: VendorIconFetchOutcome;
  /** Where the icon came from, on a hit — so a wrong match is visible, not silent. */
  domain?: string;
}

/**
 * Fetches a logo for one vendor and stores it, for the bulk "auto-populate
 * icons" run.
 *
 * **A vendor that already has an icon is skipped, never overwritten.** That is
 * what makes the button safe to press twice: the second run picks up only what
 * the first one missed, and an icon you chose by hand always beats a guessed
 * one. Clearing the icon first is how you ask for a different logo.
 *
 * A missing logo and a broken lookup are different outcomes on purpose. A miss
 * is the normal case — most of a card statement is businesses no logo service
 * has heard of — while a failure means the run hit something worth knowing
 * about. Neither throws: one bad vendor must not abandon the other thirty-nine.
 *
 * On a hit the vendor row is created if it didn't exist, exactly as a manual
 * upload does, so auto-populating an unsaved vendor moves it to Saved.
 */
export async function autoPopulateVendorIcon(
  repo: ExpenseRepository,
  client: VendorLogoClient,
  name: string,
): Promise<VendorIconFetchResult> {
  const trimmed = name.trim();
  if (trimmed === "") return { name, outcome: "failed" };

  const existing = repo.getVendorByName(trimmed);
  if (existing?.iconMimeType) return { name: trimmed, outcome: "already-has-icon" };

  let logo;
  try {
    logo = await client.fetch(trimmed);
  } catch {
    // The client throws only for a genuine transport problem; a "no such logo"
    // comes back as undefined. Either way the run continues.
    return { name: trimmed, outcome: "failed" };
  }
  if (!logo) return { name: trimmed, outcome: "no-logo-found" };

  // Same path a manual upload takes, so the row-creating behaviour and the size
  // and mime rules are the ones already proven there.
  const vendor = existing ?? upsertVendor(repo, { name: trimmed });
  repo.setVendorIcon(vendor.name, { data: logo.data, mimeType: logo.mimeType });
  return { name: vendor.name, outcome: "set", domain: logo.domain };
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
  /** The matched rule's name, or undefined when nothing matched. */
  ruleName?: string;
  /** The matched rule's pattern, or undefined when nothing did. */
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
      ruleName: plan?.rule.name,
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

export interface ForcedRuleApplicationResult {
  /** How many existing transactions the rule's pattern matched. */
  matchedCount: number;
  /** How many of those actually changed — a row already correct isn't counted. */
  changedCount: number;
  /** The fields the run wrote, for the message shown afterwards. */
  fieldsChanged: RuleActionField[];
}

/**
 * Runs one rule over the whole back catalogue, overwriting what's already there.
 *
 * This is the "Update Trans" button, and it's deliberately not the clean-up:
 * the clean-up walks the `processed` queue applying whichever rule matches
 * first and only filling blanks, whereas this applies *the rule you picked* to
 * every row it matches, whether or not the row has been processed and whether
 * or not the fields are already filled. That's what lets a corrected rule fix
 * rows an earlier version of it got wrong.
 *
 * `status` is the one field it won't overwrite — see `planForcedRuleApplication`.
 * The `processed` flag is left alone too: this run happens outside the queue.
 *
 * A disabled rule still runs. Asking for it by name is explicit enough, and the
 * UI warns that the rule is disabled before it gets here.
 */
export function applyRuleToExistingTransactions(
  repo: ExpenseRepository,
  ruleId: number,
): ForcedRuleApplicationResult {
  const rule = repo.getRuleById(ruleId);
  if (!rule) throw new Error(`No rule with id ${ruleId}.`);

  // Matching is the glob syntax compiled to a RegExp, which SQL can't express,
  // so the scan happens here — the same approach `previewPatternMatches` takes.
  const updates: { id: number; assignments: Partial<Record<RuleActionField, string>> }[] = [];
  const fieldsChanged = new Set<RuleActionField>();
  const categories: string[] = [];
  let matchedCount = 0;

  for (const transaction of repo.listTransactions()) {
    const plan = planForcedRuleApplication(transaction, rule);
    if (!plan) continue;
    matchedCount += 1;
    if (plan.assignments.length === 0) continue;

    const assignments: Partial<Record<RuleActionField, string>> = {};
    for (const assignment of plan.assignments) {
      assignments[assignment.fieldName] = assignment.value;
      fieldsChanged.add(assignment.fieldName);
      if (assignment.fieldName === "categoryName") categories.push(assignment.value);
    }
    updates.push({ id: transaction.id, assignments });
  }

  // A category the rule introduces must exist in the managed list, exactly as
  // it would after an import.
  if (categories.length > 0) repo.registerCategoriesIfMissing(categories);

  const changedCount = repo.forceApplyRuleAssignments(updates);
  return { matchedCount, changedCount, fieldsChanged: [...fieldsChanged] };
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
