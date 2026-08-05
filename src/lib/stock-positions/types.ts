export type PositionType = "Stock" | "ETF" | "Bond" | "MutualFund" | "Crypto" | "Other";

export type TransactionAction = "Buy" | "Sell";

/** A position's identity — a ticker within one account. `accountId` 0 is "Unassigned". */
export interface PositionKey {
  accountId: number;
  ticker: string;
}

export const UNASSIGNED_ACCOUNT_ID = 0;

export interface StockPosition {
  accountId: number;
  ticker: string;
  name: string;
  type: PositionType;
  currentPriceCents: number;
  quantity: number;
  dayGainLossCents: number;
  valueCents: number;
  dayHighCents: number;
  dayLowCents: number;
  dividendRateCents: number;
  /** Total cost basis. 0 means unknown, not free. */
  costCents: number;
  /** Average cost per share. 0 means unknown. */
  unitCostCents: number;
  /** Signed — negative is a loss. */
  unrealizedGainLossCents: number;
  /** Signed percent as the broker reports it, so an adjusted basis is preserved. */
  unrealizedGainLossPct: number;
  cusip: string;
  isin: string;
  /** The broker's asset class, e.g. "Equity". Free text — brokers disagree. */
  assetClass: string;
  /** The broker's strategy bucket, e.g. "US Large Cap". A different axis from `type`. */
  assetStrategy: string;
  /** Forward-looking annual dividend for the whole holding. */
  estAnnualIncomeCents: number;
  /** Income actually received to date. */
  incomeEarnedCents: number;
  createdAt: string;
  updatedAt: string;
}

export interface StockTransaction {
  id: number;
  transactionAt: string;
  action: TransactionAction;
  ticker: string;
  numberOfShares: number;
  pricePerShareCents: number;
  totalAmountCents: number;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface PortfolioSummary {
  positionCount: number;
  totalValueCents: number;
  totalDayGainLossCents: number;
  dayChangePct: number;
  stockValueCents: number;
  etfValueCents: number;
  otherValueCents: number;
  annualDividendIncomeCents: number;
  /** Summed over positions that report a basis; 0 when none do. */
  totalCostCents: number;
  totalUnrealizedGainLossCents: number;
  /** Total return against `totalCostCents`. 0 when no position reports a basis. */
  totalReturnPct: number;
}

/** How much something is worth and how far it moved today. */
export interface DayMove {
  valueCents: number;
  /** Signed — a down day is negative. */
  gainLossCents: number;
  /**
   * The move against what it was worth *before* moving, i.e.
   * `gain / (value - gain)`. 0 when there was nothing to move.
   */
  changePct: number;
}

/** Today's move for one ticker, summed over every account holding it. */
export interface TickerDayMove extends DayMove {
  ticker: string;
  name: string;
  type: PositionType;
  /** Total shares held across every account. */
  quantity: number;
  /**
   * The move on one share — `gainLossCents / quantity`, rounded to the cent.
   * 0 when no shares are held. Note `changePct` is the same number whichever way
   * you measure it, since a percentage is scale-free.
   */
  perShareGainLossCents: number;
  /** How many accounts hold it. >1 means the figures are a total across them. */
  accountCount: number;
}

/** Today's move split the way the dashboard reports it. */
export interface DayMovesByType {
  stock: DayMove;
  etf: DayMove;
  other: DayMove;
  total: DayMove;
}

/**
 * Which figure the top gainer/loser lists show and sort by.
 *
 * `total` is the dollar impact on the portfolio (shares × price move) — "what
 * happened to my money". `perShare` is the move on a single share — "what happened
 * to this security", independent of how much of it you hold. The percentage is the
 * same under both, so it's always shown rather than being a third choice.
 */
export type MoverMeasure = "total" | "perShare";

/** One slice of a value breakdown — by asset strategy, asset class, or account. */
export interface AllocationSlice {
  label: string;
  valueCents: number;
  /** Share of the total, 0-100. */
  sharePct: number;
}

export interface TransactionStats {
  count: number;
  avgPricePerShareCents: number;
  maxPricePerShareCents: number;
  minPricePerShareCents: number;
}
