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
  /**
   * Mime type of the category icon, or undefined when none is set. The bytes
   * themselves are fetched separately (see CategoryIcon) so they never travel
   * with a category list.
   */
  iconMimeType?: string;
  createdAt: string;
  updatedAt: string;
}

/** Raw icon bytes for one category, read only by the icon-serving route. */
export interface CategoryIcon {
  data: Buffer;
  mimeType: string;
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
  /** Tidied-up name set by post-import processing; the raw text stays put. */
  vendor: string;
  /** Charges positive, credits/refunds negative. */
  amountCents: number;
  note: string;
  status: TransactionStatus;
  /** False until the post-import rules have been run over this row. */
  processed: boolean;
  createdByUserId: number;
  createdAt: string;
  updatedAt: string;
}

/** The transaction fields a post-import rule is allowed to set. */
export const RULE_ACTION_FIELDS = ["categoryName", "vendor", "status", "note"] as const;

export type RuleActionField = (typeof RULE_ACTION_FIELDS)[number];

/** Human labels for the rule editor and the run log. */
export const RULE_ACTION_FIELD_LABELS: Record<RuleActionField, string> = {
  categoryName: "Category",
  vendor: "Vendor",
  status: "Status",
  note: "Note",
};

/** One assignment a rule performs when it matches. */
export interface RuleAction {
  id: number;
  ruleId: number;
  fieldName: RuleActionField;
  fieldValue: string;
  sortOrder: number;
}

/**
 * A post-import processing rule: one condition, many assignments. `pattern` is a
 * case-insensitive glob matched against `transactionDescription`, e.g. `*TGI*`
 * setting vendor "TGI Friday" and category "Restaurant". Rules are global — they
 * apply to every card.
 */
export interface PostImportRule {
  id: number;
  pattern: string;
  /** Lowest number wins when several rules match. */
  priority: number;
  isEnabled: boolean;
  actions: RuleAction[];
  createdAt: string;
  updatedAt: string;
}

/** Per-category rollup for the summary panel. */
export interface CategoryTotal {
  categoryName: string;
  totalCents: number;
  transactionCount: number;
}
