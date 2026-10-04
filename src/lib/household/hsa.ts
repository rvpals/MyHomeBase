/**
 * The HSA Tracker's use-cases: functions that take data and return data.
 *
 * Every one receives its dependencies as parameters — the repository, and for anything
 * touching a receipt, the file store plus the configured receipt folder — so the same
 * call runs under the web app, the CLI and a unit test with fakes.
 */

import {
  MAX_HSA_RECEIPT_BYTES,
  bulkDeleteHsaExpensesSchema,
  bulkSetReimbursedSchema,
  hsaCardIdSchema,
  hsaCardNameSchema,
  hsaExpenseIdSchema,
  hsaExpenseSchema,
  setHsaReceiptSchema,
  type BulkDeleteHsaExpensesInput,
  type BulkSetReimbursedInput,
  type HsaExpenseData,
  type HsaExpenseInput,
  type SetHsaReceiptInput,
} from "./hsa-schema";
import type { HsaRepository } from "./hsa-ports";
import type { HsaCard, HsaExpense, HsaReceipt } from "./hsa-types";
import { buildReceiptPath, receiptMimeTypeFor, withCollisionSuffix } from "./receipt-path";
import type { ReceiptFileStore } from "./receipt-store";

/** The receipt folder and the store that reads and writes it. */
export interface HsaReceiptFiles {
  store: ReceiptFileStore;
  /** The `hsa_receipt_root` setting. `""` = not set. */
  root: string;
}

const NO_FOLDER_MESSAGE =
  "No receipt folder is set — an administrator can set one in Household → Configuration.";

function requireRoot(files: HsaReceiptFiles): string {
  const root = files.root.trim();
  if (root === "") throw new Error(NO_FOLDER_MESSAGE);
  return root;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The first free path for `desired`, adding `-2`, `-3`… if a file is in the way.
 *
 * `ownPath` is the expense's current file, which never counts as "in the way" — so
 * re-filing a receipt under the name it already has overwrites it rather than
 * creating a `-2` copy beside it.
 */
async function freePath(
  files: HsaReceiptFiles,
  root: string,
  desired: string,
  ownPath: string,
): Promise<string> {
  for (let n = 1; n <= 50; n++) {
    const candidate = withCollisionSuffix(desired, n);
    if (candidate === ownPath || !(await files.store.exists(root, candidate))) return candidate;
  }
  throw new Error(`Too many files already named like ${desired}.`);
}

/** Validates the raw form shape and converts `amount` (dollars) to `amountCents`. */
function toWriteData(input: HsaExpenseInput): HsaExpenseData {
  const { amount, ...rest } = hsaExpenseSchema.parse(input);
  return { ...rest, amountCents: amount };
}

export function listHsaExpenses(repo: HsaRepository): HsaExpense[] {
  return repo.listExpenses();
}

/** One expense. `undefined` rather than a throw — a deleted id is ordinary. */
export function getHsaExpense(repo: HsaRepository, id: number): HsaExpense | undefined {
  return repo.getExpenseById(hsaExpenseIdSchema.parse(id));
}

export function createHsaExpense(repo: HsaRepository, input: HsaExpenseInput): HsaExpense {
  return repo.createExpense(toWriteData(input));
}

/**
 * Replaces an expense, and keeps its receipt file's name and year folder in step.
 *
 * The file is named from the Date, Payee and Amount, so editing any of them renames
 * it — and a new year moves it into that year's folder. The move happens FIRST: if it
 * fails nothing has been saved, and the error says why. If the database write then
 * fails, the file is moved back, so the row and the folder never disagree.
 *
 * Throws on an unknown id: the caller has an edit form open on a record it believes
 * exists, so silence would look like a save that vanished.
 */
export async function updateHsaExpense(
  repo: HsaRepository,
  files: HsaReceiptFiles,
  id: number,
  input: HsaExpenseInput,
): Promise<HsaExpense> {
  const expenseId = hsaExpenseIdSchema.parse(id);
  const data = toWriteData(input);
  const existing = repo.getExpenseById(expenseId);
  if (!existing) throw new Error(`No expense with id ${expenseId}.`);

  if (!existing.hasReceipt) {
    return repo.updateExpense(expenseId, data)!;
  }

  const desired = buildReceiptPath({ id: expenseId, ...data, mimeType: existing.receiptMimeType });
  if (desired === existing.receiptPath) {
    return repo.updateExpense(expenseId, data)!;
  }

  const root = requireRoot(files);
  const target = await freePath(files, root, desired, existing.receiptPath);
  try {
    await files.store.move(root, existing.receiptPath, target);
  } catch (error) {
    throw new Error(`Nothing was saved: the receipt file could not be moved to ${target} (${messageOf(error)}).`);
  }
  try {
    repo.updateExpense(expenseId, data);
    repo.setReceiptPath(expenseId, target);
  } catch (error) {
    await files.store.move(root, target, existing.receiptPath).catch(() => undefined);
    throw error;
  }
  return repo.getExpenseById(expenseId)!;
}

export interface DeleteHsaExpensesResult {
  removed: number;
  /** Receipt files whose rows were deleted but which could not be removed from the folder. */
  filesNotDeleted: string[];
}

/**
 * Deletes expenses and their receipt files.
 *
 * Rows first, then files: a file left behind is a visible orphan in a folder, whereas a
 * row pointing at a deleted file would be a broken link on screen. A file that can't be
 * removed is reported, not thrown — the rows are already gone, and an error would read
 * as though nothing happened.
 */
export async function deleteHsaExpenses(
  repo: HsaRepository,
  files: HsaReceiptFiles,
  input: BulkDeleteHsaExpensesInput,
): Promise<DeleteHsaExpensesResult> {
  const { ids } = bulkDeleteHsaExpensesSchema.parse(input);
  const receiptPaths = ids
    .map((id) => repo.getExpenseById(id))
    .filter((expense): expense is HsaExpense => expense !== undefined && expense.hasReceipt)
    .map((expense) => expense.receiptPath);

  const removed = repo.deleteExpenses(ids);
  const filesNotDeleted: string[] = [];
  for (const receiptPath of receiptPaths) {
    try {
      await files.store.remove(requireRoot(files), receiptPath);
    } catch {
      filesNotDeleted.push(receiptPath);
    }
  }
  return { removed, filesNotDeleted };
}

/** Marks a selection reimbursed (or not). Returns how many rows changed. */
export function setHsaReimbursed(repo: HsaRepository, input: BulkSetReimbursedInput): number {
  const { ids, isReimbursed } = bulkSetReimbursedSchema.parse(input);
  return repo.setReimbursed(ids, isReimbursed);
}

/** The receipt bytes, read from the folder. Only the serving route calls this. */
export async function getHsaReceipt(
  repo: HsaRepository,
  files: HsaReceiptFiles,
  id: number,
): Promise<HsaReceipt | undefined> {
  const expense = repo.getExpenseById(hsaExpenseIdSchema.parse(id));
  if (!expense?.hasReceipt || files.root.trim() === "") return undefined;
  const data = await files.store.read(files.root.trim(), expense.receiptPath);
  if (!data) return undefined;
  const fileName = expense.receiptPath.slice(expense.receiptPath.lastIndexOf("/") + 1);
  return {
    data,
    mimeType: expense.receiptMimeType || receiptMimeTypeFor(fileName) || "application/octet-stream",
    fileName,
  };
}

export interface SetHsaReceiptResult {
  /** Where the receipt was filed, relative to the receipt folder. */
  path: string;
  /** Set when a replaced file could not be removed and is left in the folder. */
  oldFileNotDeleted?: string;
}

/**
 * Checks an uploaded receipt and files it under `<folder>/<YYYY>/`.
 *
 * Refused outright when no folder is set — receipts live in exactly one place. The file
 * is stored as it arrived (the browser has already shrunk a large phone photo); the
 * checks here — type allowlist, size cap, a PDF's own signature — are the real ones.
 *
 * Replacing a receipt writes the new file, records it, and only then deletes the old
 * one, so a failure at any step leaves a working receipt behind.
 */
export async function setHsaReceipt(
  repo: HsaRepository,
  files: HsaReceiptFiles,
  input: SetHsaReceiptInput,
): Promise<SetHsaReceiptResult> {
  const { id, receipt } = setHsaReceiptSchema.parse(input);
  const root = requireRoot(files);
  const expense = repo.getExpenseById(id);
  if (!expense) throw new Error(`No expense with id ${id}.`);

  const data = Buffer.from(receipt.base64Data, "base64");
  if (data.length === 0) throw new Error("The file could not be read.");
  if (data.length > MAX_HSA_RECEIPT_BYTES) {
    throw new Error(
      `That file is too large — keep a receipt under ${(MAX_HSA_RECEIPT_BYTES / 1024 / 1024).toFixed(1)} MB.`,
    );
  }
  // The declared type is the browser's guess; the file's own first bytes are not.
  if (receipt.mimeType === "application/pdf" && data.subarray(0, 5).toString("latin1") !== "%PDF-") {
    throw new Error("That file is not a PDF.");
  }

  const desired = buildReceiptPath({ ...expense, mimeType: receipt.mimeType });
  const target = await freePath(files, root, desired, expense.receiptPath);
  await files.store.write(root, target, data);
  repo.setReceipt(id, { path: target, mimeType: receipt.mimeType, fileName: receipt.fileName });

  const oldPath = expense.receiptPath;
  if (oldPath === "" || oldPath === target) return { path: target };
  try {
    await files.store.remove(root, oldPath);
    return { path: target };
  } catch {
    return { path: target, oldFileNotDeleted: oldPath };
  }
}

/**
 * Removes an expense's receipt: unlinks it, then deletes the file.
 *
 * Unlinked first for the same reason as `deleteHsaExpenses`. If the file then can't be
 * deleted the error says the receipt is already off the expense, so retrying the
 * removal isn't the fix — the file is named, to be deleted by hand.
 */
export async function clearHsaReceipt(
  repo: HsaRepository,
  files: HsaReceiptFiles,
  id: number,
): Promise<void> {
  const expense = repo.getExpenseById(hsaExpenseIdSchema.parse(id));
  if (!expense?.hasReceipt) return;
  const root = requireRoot(files);
  repo.clearReceipt(expense.id);
  try {
    await files.store.remove(root, expense.receiptPath);
  } catch (error) {
    throw new Error(
      `The receipt was removed from the expense, but the file ${expense.receiptPath} could not be deleted (${messageOf(error)}).`,
    );
  }
}

/** Every product or service already recorded — the editor's autocomplete. */
export function listHsaProductServices(repo: HsaRepository): string[] {
  return repo.listProductServices();
}

/** Every card, active or not — the Configuration screen. The editor offers only `isActive` ones. */
export function listHsaCards(repo: HsaRepository): HsaCard[] {
  return repo.listCards();
}

export function createHsaCard(repo: HsaRepository, name: string): HsaCard {
  return repo.createCard(hsaCardNameSchema.parse(name));
}

export function renameHsaCard(repo: HsaRepository, id: number, name: string): HsaCard {
  const cardId = hsaCardIdSchema.parse(id);
  const renamed = repo.renameCard(cardId, hsaCardNameSchema.parse(name));
  if (!renamed) throw new Error(`No card with id ${cardId}.`);
  return renamed;
}

export function setHsaCardActive(repo: HsaRepository, id: number, isActive: boolean): HsaCard {
  const cardId = hsaCardIdSchema.parse(id);
  const card = repo.setCardActive(cardId, isActive);
  if (!card) throw new Error(`No card with id ${cardId}.`);
  return card;
}

/**
 * Deletes a card from the pick list. Expenses already paid with it keep the name —
 * `paid_with` is a snapshot, so there is nothing to detach.
 */
export function deleteHsaCard(repo: HsaRepository, id: number): void {
  repo.deleteCard(hsaCardIdSchema.parse(id));
}
