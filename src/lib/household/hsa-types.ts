/**
 * The HSA Tracker's domain types.
 *
 * One shape for an expense, not a summary/full pair like recipes: every field is
 * small, and the only heavy thing — the receipt bytes — is never on the row at all.
 * `hasReceipt` is derived in SQL, so the list and the editor read the same type and
 * the editor cannot be filled from a partial row.
 */

/** The expense types, in the order the editor offers them. Enforced in zod. */
export const HSA_TYPES = [
  "Pharmacy",
  "Medical",
  "Dental",
  "Vision",
  "Transportation",
  "Dependent Care",
  "Other",
] as const;

export type HsaType = (typeof HSA_TYPES)[number];

export interface HsaExpense {
  id: number;
  /** YYYY-MM-DD. */
  entryDate: string;
  /** HH:MM, or empty when none was recorded. */
  entryTime: string;
  amountCents: number;
  productService: string;
  type: HsaType;
  /** The store or doctor's office. */
  payee: string;
  /** YYYY-MM-DD, or `null` when not recorded. */
  serviceDate: string | null;
  /** The card's name as it was when entered — a snapshot, not an id. Empty = unrecorded. */
  paidWith: string;
  note: string;
  isReimbursed: boolean;
  /** Derived from `receiptPath`, never stored on its own. */
  hasReceipt: boolean;
  /**
   * Where the receipt is filed, relative to the receipt folder, e.g.
   * `2026/2026-10-03_CVS_$42.50_17.jpg`. Empty when there is no receipt.
   */
  receiptPath: string;
  /** What the uploaded file was originally called. Empty when there is no receipt. */
  receiptFileName: string;
  /** Empty when there is no receipt. */
  receiptMimeType: string;
  createdAt: string;
  updatedAt: string;
}

/** A receipt file, read only by the route that serves the bytes. */
export interface HsaReceipt {
  data: Buffer;
  mimeType: string;
  fileName: string;
}

/** One entry of the "Paid with" pick list. */
export interface HsaCard {
  id: number;
  name: string;
  isActive: boolean;
  createdAt: string;
}
