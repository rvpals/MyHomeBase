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
   * Day of the month this card's statement closes, 1–31, and that day is *on*
   * the statement — a card closing on the 28th has a cycle running 29 Jul to
   * 28 Aug. 0 means "never set", which only rows predating migration 0070 carry;
   * `normalizeCloseDay` resolves it to the default rather than failing. A close
   * day past the end of a short month is clamped to that month's last day, as
   * every issuer does. See `billing-cycle.ts`.
   */
  statementCloseDay: number;
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

/**
 * A saved vendor: the editable identity behind a vendor name — a description and
 * an icon. Distinct from `VendorTotal`, which is a spend rollup derived from the
 * transactions; a vendor can appear in a rollup with no row here, which is the
 * normal state until you give it a description or an icon.
 */
export interface ExpenseVendor {
  name: string;
  description: string;
  /**
   * Mime type of the vendor icon, or undefined when none is set. The bytes
   * themselves are fetched separately (see VendorIcon) so they never travel
   * with a vendor list.
   */
  iconMimeType?: string;
  createdAt: string;
  updatedAt: string;
}

/** Raw icon bytes for one vendor, read only by the icon-serving route. */
export interface VendorIcon {
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
 * case-insensitive glob matched against `transactionDescription`, e.g. `%TGI%`
 * setting vendor "TGI Friday" and category "Restaurant". Rules are global — they
 * apply to every card.
 *
 * The wildcard is `%`, not `*`: statement descriptions print asterisks
 * constantly (`AMAZON.COM*2A34B5C6`), so `*` is a literal here. See
 * `compilePattern`. Migration 0069 rewrote every stored `*` to `%`.
 */
export interface PostImportRule {
  id: number;
  /**
   * Short human label, e.g. "TGI Friday's". Required on save; blank only on rules
   * that predate migration 0065 and whose pattern was whitespace-only, so display
   * code falls back to `pattern`.
   */
  name: string;
  /** Optional longer note on why this rule exists. Empty means none. */
  description: string;
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

/** Per-vendor rollup for the summary panel. See `vendors.ts` for how rows are grouped. */
export interface VendorTotal {
  /**
   * Display name: the tidied `vendor` when any row in the group carried one,
   * otherwise the brand key derived from the raw statement description. Empty
   * when neither yielded anything.
   */
  vendor: string;
  totalCents: number;
  transactionCount: number;
  /**
   * True when no row in the group had a `vendor`, so the name came from the raw
   * description and may read a little rough.
   */
  isDerived: boolean;
}
