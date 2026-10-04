import type { HsaExpenseData } from "./hsa-schema";
import type { HsaCard, HsaExpense } from "./hsa-types";

/**
 * What the HSA Tracker's use-cases need from the database.
 *
 * Its own port rather than more methods on `HouseholdRepository`: the recipe box and
 * the HSA share a table prefix, not behaviour, and a second interface keeps each
 * module's test fake limited to the methods it actually exercises.
 *
 * The receipt FILES are not here — they live in the receipt folder, behind
 * `ReceiptFileStore`. This port only records where each one is.
 */
export interface HsaRepository {
  /** Every expense, newest first (date, then time, then id). */
  listExpenses(): HsaExpense[];

  getExpenseById(id: number): HsaExpense | undefined;

  createExpense(input: HsaExpenseData): HsaExpense;

  /** Replaces every field except the receipt. `undefined` when the id is unknown. */
  updateExpense(id: number, input: HsaExpenseData): HsaExpense | undefined;

  deleteExpenses(ids: number[]): number;

  /** Sets the flag on each id in one transaction, returning how many rows changed. */
  setReimbursed(ids: number[], isReimbursed: boolean): number;

  /** Records a newly filed receipt. */
  setReceipt(id: number, receipt: { path: string; mimeType: string; fileName: string }): void;
  /** Records that the receipt file was moved or renamed. */
  setReceiptPath(id: number, path: string): void;
  clearReceipt(id: number): void;

  /**
   * Every product or service already recorded, one spelling each, for the editor's
   * autocomplete. `SELECT DISTINCT` over the expenses, not a catalog table, so it
   * can never offer a value nothing used.
   */
  listProductServices(): string[];

  /** Every card, active or not, alphabetical. */
  listCards(): HsaCard[];
  getCardById(id: number): HsaCard | undefined;
  /** Throws when the name is already taken (case-insensitive). */
  createCard(name: string): HsaCard;
  /** `undefined` when the id is unknown. Throws when the name is taken. */
  renameCard(id: number, name: string): HsaCard | undefined;
  setCardActive(id: number, isActive: boolean): HsaCard | undefined;
  deleteCard(id: number): void;
}
