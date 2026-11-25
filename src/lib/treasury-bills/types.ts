/**
 * One US Treasury Bill purchase, exactly as it is stored.
 *
 * A bill is bought at a discount to face value and redeemed at par on a date fixed
 * at purchase, so every field here is known the day the confirmation prints —
 * including the payout. There is no "pending" state to model. See
 * `migrations/0186_create_tbill_purchases.md`.
 */
export interface TBillPurchase {
  id: number;
  /** The symbol as the broker shows it. Free text — a Treasury CUSIP, not a ticker. */
  symbol: string;
  /** The broker's own long description of the instrument. */
  description: string;
  /** ISO YYYY-MM-DD. */
  datePurchased: string;
  /** ISO YYYY-MM-DD — the maturity date. */
  datePayout: string;
  sharesPurchased: number;
  /**
   * Price per **$100 of face value**, as the confirmation quotes it (e.g. 98.6375).
   * A quoted rate, not an amount of money, which is why it is not in cents — the
   * yield formula is only meaningful against this unit.
   */
  purchasePrice: number;
  amountSpentCents: number;
  payoutAmountCents: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * A purchase with the four derived figures attached.
 *
 * None of these is a column: they are recomputed on every read, so a row can never
 * disagree with the values it was computed from. What the grid renders.
 */
export interface TBillPurchaseView extends TBillPurchase {
  /** Payout minus amount spent. Negative is possible and is not an error. */
  gainAmountCents: number;
  /**
   * Gain as a percentage of what was spent.
   *
   * `undefined`, never 0, when nothing was spent — a zero there would be
   * indistinguishable from a genuinely flat return. Same rule the Tax Lots XIRR
   * follows, and it is why the grid prints "—".
   */
  gainPct?: number;
  /** Calendar days from purchase to maturity. */
  daysToMaturity: number;
  /**
   * The annualised discount yield:
   * `(100 - price) / price * 100 * 365 / days`.
   *
   * `undefined` when there is nothing to solve — a same-day maturity, or a
   * non-positive price. Never 0, for the reason given on `gainPct`.
   */
  yieldPct?: number;
}

/**
 * One point on the "total gain over time" line.
 *
 * The axis is the **payout** date, not the purchase date: a bill's gain is realised
 * when it matures, so plotting it against the day it was bought would credit the
 * money months before it arrived.
 */
export interface TBillGainPoint {
  /** ISO YYYY-MM-DD — a payout date at which at least one bill matured. */
  date: string;
  /** Running total of gain realised up to and including this date. */
  cumulativeGainCents: number;
  /** How many bills have matured by this date. */
  maturedCount: number;
}

/** Everything the T-Bill Stats card renders. */
export interface TBillStats {
  purchaseCount: number;
  totalInvestedCents: number;
  totalGainedCents: number;
  /** Total gained over total invested. `undefined` when nothing was invested. */
  totalReturnPct?: number;
  /**
   * The plain mean of the yield column — unweighted, so a $500 bill counts the same
   * as a $50,000 one. Confirmed as the intended reading. `undefined` when no row has
   * a computable yield.
   */
  averageYieldPct?: number;
  /** The plain mean of the gain column. `undefined` when there are no rows. */
  averageGainCents?: number;
  /** Oldest first. Empty when there are no purchases. */
  gainOverTime: TBillGainPoint[];
}
