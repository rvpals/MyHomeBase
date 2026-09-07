// Domain models for the Tax Lot Portfolio Analyzer.
//
// Two vocabularies live here and must not be confused:
//
//   *raw*      — the numbers as the broker's confirmation printed them on the buy
//                date. A 2019 NVDA lot says 10 shares at $180.
//   *adjusted* — the same economic position expressed in today's shares. That lot
//                is 400 shares at $4.50 after a 4:1 and a 10:1 split.
//
// Every figure a user compares against today's market price must be adjusted; every
// figure entered from a paper statement is raw. The stored flag on a lot says which
// one the entered numbers already are.

/** One corporate action: `ratio` new shares for every old share on `effectiveDate`. */
export interface StockSplit {
  /** ISO date (YYYY-MM-DD) the split took effect — the first day shares traded split. */
  effectiveDate: string;
  /**
   * New shares per old share. A 4:1 forward split is 4. A 1:10 reverse split is 0.1,
   * which is why this is a ratio and not two integers.
   */
  ratio: number;
  /** How the action is conventionally written, e.g. "4:1". Display only. */
  label: string;
}

/** Every split known for one ticker, and the ticker it belongs to. */
export interface SplitHistory {
  ticker: string;
  /** Oldest first. `cumulativeSplitFactor` does not rely on this order. */
  splits: StockSplit[];
}

export type TaxClassification = "LONG_TERM" | "SHORT_TERM";

/** A purchase as entered, before any split maths. Money in dollars, not cents. */
export interface RawLot {
  /** ISO date (YYYY-MM-DD) the shares were bought. */
  buyDate: string;
  /** Shares as the confirmation printed them. */
  rawShares: number;
  /** Price per share as the confirmation printed it, in dollars. */
  rawPrice: number;
}

/**
 * A purchase restated in today's shares.
 *
 * `costBasis` is invariant across the normalization — a split changes how the same
 * dollars are divided into shares, never how many dollars were spent. That identity
 * is what the normalization tests assert.
 */
export interface NormalizedLot extends RawLot {
  /** `rawShares * cumulativeSplitFactor`. */
  adjustedShares: number;
  /** `rawPrice / cumulativeSplitFactor`. */
  adjustedCostPerShare: number;
  /** The product of every split effective strictly after `buyDate`. 1 when none were. */
  cumulativeSplitFactor: number;
  /** `adjustedShares * adjustedCostPerShare`. */
  costBasis: number;
}

/** One lot scored against a current market price. */
export interface LotPerformance extends NormalizedLot {
  /** The lot's database id, when it came from storage. Absent for an ad-hoc lot. */
  id?: number;
  ticker: string;
  /** `adjustedShares * currentMarketPrice`. */
  currentValue: number;
  /** Signed — a losing lot is negative. */
  unrealizedGainDollars: number;
  /** Signed percent against `costBasis`. 0 when the basis is 0. */
  unrealizedGainPercent: number;
  /** `(today - buyDate) / 365.25`. Never negative. */
  yearsHeld: number;
  /** Compound annual growth rate as a fraction — 0.15 is 15%. 0 when held under a day. */
  cagr: number;
  /** `(trailingEPS / adjustedCostPerShare) * 100`. 0 when no EPS is known. */
  yieldOnCost: number;
  taxClassification: TaxClassification;
  /**
   * True when this lot can be sold at the long-term capital-gains rate *and* is in
   * profit — i.e. it is a candidate for tax-efficient trimming. A long-term lot at a
   * loss is not a trimming candidate, it is a harvesting one, which is a different
   * screen.
   */
  isTrimCandidate: boolean;
}

/** The portfolio-level roll-up across every lot of one ticker. */
export interface PortfolioLotSummary {
  ticker: string;
  lotCount: number;
  /** Sum of `adjustedShares`. */
  totalAdjustedShares: number;
  /** Sum of `costBasis` — every dollar put in. */
  totalCapitalInvested: number;
  /** Sum of `currentValue`. */
  totalCurrentValue: number;
  /** Signed. */
  totalGainDollars: number;
  /** Signed percent against `totalCapitalInvested`. 0 when nothing was invested. */
  totalGainPercent: number;
  /** `totalCapitalInvested / totalAdjustedShares`. 0 when no shares are held. */
  blendedCostBasis: number;
  /** `(trailingEPS / blendedCostBasis) * 100`. 0 when no EPS is known. */
  blendedYieldOnCost: number;
  /**
   * Money-weighted return as a fraction — 0.22 is 22%. `undefined` when the solver
   * could not converge (see `computeXirr`), which is reported as "—" rather than
   * silently shown as 0.
   */
  xirr?: number;
  /** How many lots, and how much value, are already long-term. */
  longTermLotCount: number;
  longTermValue: number;
  shortTermLotCount: number;
  shortTermValue: number;
  /** The price every `currentValue` above was struck at. */
  currentMarketPrice: number;
}

/** A dated cash movement, as the XIRR solver consumes it. Outflows are negative. */
export interface CashFlow {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** Signed: money leaving your pocket is negative, money coming back is positive. */
  amount: number;
}

/** A stored purchase. The presentation layer never sees the raw database row. */
export interface TaxLot {
  id: number;
  ticker: string;
  /** ISO date (YYYY-MM-DD). */
  buyDate: string;
  shares: number;
  /** Integer cents, matching every other money column in the schema. */
  pricePerShareCents: number;
  /**
   * True when `shares`/`pricePerShareCents` are ALREADY expressed in today's
   * post-split shares — a modern broker export usually is. False means they are
   * the historical figures and the split table must be applied.
   */
  isSplitAdjusted: boolean;
  brokerageFirm: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}
