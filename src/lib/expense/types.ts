// Domain models for the Expense tracker. Money is always cents (integers) —
// dollars only exist at the edges, for display and for parsing user input.

/** Where a transaction sits in the reconciliation workflow. */
export const TRANSACTION_STATUSES = ["new", "reconciled", "irreconcilable"] as const;

export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export interface CreditCardAccount {
  id: number;
  name: string;
  description: string;
  creditLineCents: number;
  /**
   * Mime type of the card image, or undefined when none is set. The bytes
   * themselves are fetched separately (see CardImage) so they never travel with
   * an account list.
   */
  imageMimeType?: string;
  createdAt: string;
  updatedAt: string;
}

/** Raw image bytes for one card, read only by the image-serving route. */
export interface CardImage {
  data: Buffer;
  mimeType: string;
}

export interface ExpenseCategory {
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseTransaction {
  id: number;
  /** YYYY-MM-DD, when the purchase happened. */
  transactionDate: string;
  /** YYYY-MM-DD when the card posted it; empty when the statement omits it. */
  postingDate: string;
  transactionAccountId: number;
  /** Raw vendor text from the statement — the fuzzy-match input. */
  transactionDescription: string;
  /** Empty means "not categorised yet". */
  categoryName: string;
  /** Charges positive, credits/refunds negative. */
  amountCents: number;
  note: string;
  status: TransactionStatus;
  createdByUserId: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * A vendor→category rule. `pattern` is a case-insensitive glob matched against
 * `transactionDescription`; `applyStatus` is optional (empty = leave the status
 * alone). Rules are global — they apply to every card.
 */
export interface CategoryRule {
  id: number;
  pattern: string;
  categoryName: string;
  applyStatus: TransactionStatus | "";
  /** Lowest number wins when several rules match. */
  priority: number;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Per-category rollup for the summary panel. */
export interface CategoryTotal {
  categoryName: string;
  totalCents: number;
  transactionCount: number;
}
