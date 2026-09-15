/**
 * The shapes behind "Consult AI about this ticker" — one symbol's position and
 * trade history, flattened into something a language model can reason about.
 *
 * Everything here is derived. Nothing is stored, so there is no table, no
 * repository and no migration: the prompt is rebuilt from the position rows and
 * transactions that already exist each time the button is pressed. Same shape of
 * decision as `lib/portfolio-export`, one symbol wide instead of a portfolio.
 */

import type { TransactionAction } from "@/lib/stock-positions";

/**
 * Where the reference price came from.
 *
 * Load-bearing, not decoration: the ±15% band is anchored on this price, so a
 * reader — and the model — must know whether it is a settled close or a number
 * that was still moving when the button was pressed. An `intraday` price makes
 * the band provisional in a way a `close` does not.
 */
export type ReferencePriceSource = "intraday" | "close" | "recorded";

/** The price the alternatives are screened against, and what kind of price it is. */
export interface ReferencePrice {
  cents: number;
  source: ReferencePriceSource;
  /** ISO instant the figure was read. What "as of" means, precisely. */
  asOf: string;
}

/**
 * The band an alternative's price has to fall inside.
 *
 * Carried as computed cents rather than leaving the arithmetic to the prompt
 * string, so the same two numbers appear in the prompt, in a test, and in
 * anything else that ever screens on them.
 */
export interface PriceBand {
  /** The percentage either side of the reference price. */
  tolerancePct: number;
  lowCents: number;
  highCents: number;
}

/** One account's share of the position, as the broker reported it. */
export interface ConsultHolding {
  accountName: string;
  quantity: number;
  /** 0 means unknown, not free. */
  costCents: number;
  unitCostCents: number;
  valueCents: number;
}

/** One recorded trade, reduced to what the analysis actually needs. */
export interface ConsultTrade {
  /** Local-calendar "YYYY-MM-DD" — the day the trade happened. */
  date: string;
  action: TransactionAction;
  numberOfShares: number;
  pricePerShareCents: number;
  totalAmountCents: number;
  /** Empty when the export recorded none. */
  brokerageFirm: string;
}

/** The position as it stands, summed over every account. */
export interface ConsultPosition {
  isHeld: boolean;
  isWatched: boolean;
  quantity: number;
  accountCount: number;
  /** Summed only over accounts that report a basis; 0 when none do. */
  costCents: number;
  /** Value-weighted average cost per share. 0 when no basis is recorded. */
  averageUnitCostCents: number;
  valueCents: number;
  unrealizedGainLossCents: number;
  /** Return against `costCents`. 0 when no account reports a basis. */
  totalReturnPct: number;
  /** True when no account reports a basis — the gain figures are then meaningless. */
  hasCostBasis: boolean;
  /** This ticker as a share of every held position, 0-100. */
  portfolioWeightPct: number;
  holdings: ConsultHolding[];
}

/** The recorded trade history, oldest first. */
export interface ConsultTradeHistory {
  /** Oldest first — the prompt reads as a story of the position being built. */
  trades: ConsultTrade[];
  buyCount: number;
  sellCount: number;
  sharesBought: number;
  sharesSold: number;
  totalBoughtCents: number;
  totalSoldCents: number;
  /** Local-calendar dates of the oldest and newest recorded trade. */
  firstTradeDate?: string;
  lastTradeDate?: string;
}

/**
 * Everything the consult prompt is built from.
 *
 * `sector` is optional because it comes from the provider's company profile,
 * which is a separate fetch from the position — and an ETF genuinely has none.
 * The prompt has a branch for its absence rather than inventing one.
 */
export interface TickerConsultInput {
  ticker: string;
  /** The name on the position rows, or the provider's short name. Empty when neither. */
  name: string;
  /** The provider's sector for this symbol. Absent when unknown or not applicable. */
  sector?: string;
  /** The provider's industry, when it reported one. Narrows the "same sector" ask. */
  industry?: string;
  referencePrice: ReferencePrice;
  band: PriceBand;
  position: ConsultPosition;
  history: ConsultTradeHistory;
}

/** The generated prompt, plus the name to save it under. */
export interface TickerConsultPrompt {
  ticker: string;
  /** The prompt text, ready to paste or edit. */
  content: string;
  /** Suggested download name, e.g. "AAPL-ai-consult-2026-09-14.md". */
  fileName: string;
}

/** The default band either side of the reference price, as a percentage. */
export const DEFAULT_TOLERANCE_PCT = 15;
