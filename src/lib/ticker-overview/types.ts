// Everything the ticker viewer shows about one symbol, split by where it came
// from: `TickerOwnData` is what MyHomeBase itself recorded, and the market types
// below are what the provider said. The split is deliberate and load-bearing —
// the viewer groups its tabs the same way, so a number's provenance is never a
// guess. Nothing here mixes the two sources into a single blended figure.

import type { MarketEvent } from "@/lib/market-data";
import type {
  PositionType,
  StockTransaction,
  TransactionAction,
  TransactionStats,
} from "@/lib/stock-positions";
import type { RawNewsStory } from "@/lib/ticker-news";

// ---------------------------------------------------------------------------
// Our own data — read from the database, no provider calls.
// ---------------------------------------------------------------------------

/** One account's holding of the ticker. A symbol can sit in several accounts. */
export interface TickerHolding {
  accountId: number;
  /** Resolved for display; "Unassigned" for the pseudo-account (id 0). */
  accountName: string;
  quantity: number;
  currentPriceCents: number;
  /** Total cost basis for this account's shares. 0 means unknown, not free. */
  costCents: number;
  unitCostCents: number;
  valueCents: number;
  dayGainLossCents: number;
  unrealizedGainLossCents: number;
  unrealizedGainLossPct: number;
}

/** The holdings summed across every account. */
export interface TickerHoldingTotals {
  accountCount: number;
  quantity: number;
  /** Summed only over accounts that report a basis; 0 when none do. */
  costCents: number;
  valueCents: number;
  dayGainLossCents: number;
  /** Today's move against what the holding was worth before it. 0 when nothing to move. */
  dayChangePct: number;
  unrealizedGainLossCents: number;
  /** Return against `costCents`. 0 when no account reports a basis. */
  totalReturnPct: number;
  /** Value-weighted average cost per share. 0 when no basis is recorded. */
  averageUnitCostCents: number;
}

/** What the holding pays. All figures come from the broker's own numbers. */
export interface TickerIncome {
  /** Annual dividend per share, as the broker reports it. */
  dividendRateCents: number;
  /** Forward-looking annual income across every account. */
  estAnnualIncomeCents: number;
  /** Income actually received to date. */
  incomeEarnedCents: number;
  /** Annual dividend against current value, 0-100. 0 when the holding has no value. */
  yieldOnValuePct: number;
  /** Annual dividend against cost basis, 0-100. 0 when no basis is recorded. */
  yieldOnCostPct: number;
}

/** The recorded trade history for the ticker, across every brokerage. */
export interface TickerTrades {
  /** Newest first. */
  transactions: StockTransaction[];
  stats: TransactionStats;
  /** Weighted average from the buy rows; undefined when none are recorded. */
  averageCostBasisCents?: number;
  buyCount: number;
  sellCount: number;
  sharesBought: number;
  sharesSold: number;
  totalBoughtCents: number;
  totalSoldCents: number;
  /** ISO instants of the oldest and newest recorded trade. */
  firstTradeAt?: string;
  lastTradeAt?: string;
}

/** The ticker's presence on one watchlist, and how it has moved since. */
export interface TickerWatchEntry {
  itemId: number;
  watchListId: number;
  watchListName: string;
  addedDate: string;
  priceWhenAddedCents: number;
  shares: number;
  /**
   * Move from the price when it was added to the price on the position row.
   * 0 when either price is missing — a watched-but-unheld ticker has no current
   * price of our own, so this stays 0 rather than inventing one.
   */
  changeSinceAddedCents: number;
  changeSinceAddedPct: number;
  reminderAt?: string;
  reminderMessage: string;
}

/**
 * Everything MyHomeBase knows about a ticker from its own records.
 *
 * Returned for any symbol, including one that is only watched and never held —
 * in that case `isHeld` is false and the holding figures are all zero, which is
 * a meaningful answer rather than a missing one.
 */
export interface TickerOwnData {
  ticker: string;
  /** The name on the position rows. Empty when the ticker is only watched. */
  name: string;
  /** Absent when nothing is held, since the type lives on the position row. */
  type?: PositionType;
  isHeld: boolean;
  isWatched: boolean;
  holdings: TickerHolding[];
  totals: TickerHoldingTotals;
  income: TickerIncome;
  trades: TickerTrades;
  watchEntries: TickerWatchEntry[];
  /** Broker-reported identifiers and buckets, taken from the first holding. */
  assetClass: string;
  assetStrategy: string;
  cusip: string;
  isin: string;
  /** When a position row for this ticker was last written. */
  lastUpdatedAt?: string;
}

// ---------------------------------------------------------------------------
// Market data — everything below is the provider's answer, fetched on demand.
// ---------------------------------------------------------------------------

/** A live quote, with the day's move worked out. */
export interface TickerQuote {
  ticker: string;
  shortName?: string;
  priceCents: number;
  previousCloseCents: number;
  /** Signed against the previous close. */
  changeCents: number;
  changePct: number;
  dayHighCents: number;
  dayLowCents: number;
  dividendRateCents: number;
  /** ISO instant the quote was fetched — a quote is only true for a moment. */
  fetchedAt: string;
}

/** The windows the price chart offers. Values are the provider's range vocabulary. */
export const TICKER_HISTORY_RANGES = ["1mo", "3mo", "6mo", "1y", "5y"] as const;

export type TickerHistoryRange = (typeof TICKER_HISTORY_RANGES)[number];

/** One close in a chartable series. `date` is local-calendar "YYYY-MM-DD". */
export interface TickerClosePoint {
  date: string;
  closeCents: number;
  volume?: number;
}

/** A price window plus the summary figures the chart is captioned with. */
export interface TickerPriceSeries {
  ticker: string;
  range: TickerHistoryRange;
  /** Oldest first, so it charts left to right. */
  points: TickerClosePoint[];
  startCloseCents: number;
  endCloseCents: number;
  changeCents: number;
  changePct: number;
  highCents: number;
  lowCents: number;
  /** Mean daily volume over the window; undefined when the provider reported none. */
  averageVolume?: number;
}

/** Risk and range statistics computed from a year of the provider's closes. */
export interface TickerRisk {
  ticker: string;
  annualizedVolPct: number;
  dailyStdDevPct: number;
  /** "Low" | "Moderate" | "High" | "Very High" — the shared classification. */
  volatilityLabel: string;
  low52wCents: number;
  high52wCents: number;
  currentPriceCents: number;
  /** Where the current price sits in the 52-week range, 0-100. */
  rangePositionPct: number;
  /** Correlation to the benchmark over the same window; null when uncomputable. */
  marketCorrelation: number | null;
  marketBenchmarkTicker: string;
  /** Annualized simple return over the window, as a percent. */
  annualizedReturnPct: number;
  /** How many closes the figures were computed from. */
  sampleCount: number;
  calculatedAt: string;
}

/** A story with the same relevance flags the single-story picker attaches. */
export interface TickerStory extends RawNewsStory {
  /** True when the ticker leads the story rather than being a passing mention. */
  isPrimarySubject: boolean;
  isFromToday: boolean;
}

/** The recent-news list for one ticker, most relevant first. */
export interface TickerNewsFeed {
  ticker: string;
  stories: TickerStory[];
}

// ---------------------------------------------------------------------------
// The trade timeline — our trades plotted against the provider's closes. The
// one place the two sources sit on the same axis, which is the whole point of
// it: "what did I pay, and what was the market doing either side of that?".
// ---------------------------------------------------------------------------

/**
 * What a point on the timeline represents.
 *
 * `prevClose`/`nextClose` are the market's closing price on the trading day
 * either side of a trade — not necessarily the calendar day before and after,
 * since markets shut at weekends. `current` is the latest close the provider
 * has, which is what the holding is marked at now.
 */
export type TickerTimelineKind = "prevClose" | "trade" | "nextClose" | "current" | "event";

export interface TickerTimelinePoint {
  /** Local-calendar "YYYY-MM-DD". */
  date: string;
  kind: TickerTimelineKind;
  /** Our price for a `trade`; the provider's close for every other kind. */
  pricePerShareCents: number;
  /** Set on a `trade` point only. */
  transactionId?: number;
  action?: TransactionAction;
  numberOfShares?: number;
  /** The note recorded against the trade. Empty when none was. */
  note?: string;
  /**
   * Stories the provider published on this point's date. Usually empty —
   * see `newsFromDate`, the news lookup only reaches back so far.
   */
  stories: TickerStory[];
  /**
   * Dividends, splits and reported quarters dated to this point. Unlike news,
   * these go back as far as the price history does, so an old point having one
   * is normal.
   */
  events: MarketEvent[];
}

export interface TickerTradeTimeline {
  ticker: string;
  /** Oldest first. Empty when no transaction is recorded for the ticker. */
  points: TickerTimelinePoint[];
  /** Average / highest / lowest price per share across the recorded trades. */
  tradeStats: TransactionStats;
  /** The latest close the provider returned. 0 when there was no history. */
  currentPriceCents: number;
  /**
   * Trade dates the provider had no close either side of — a trade older than
   * the fetched window, or a symbol it has no history for. Reported rather than
   * silently dropped so the chart's gaps are explainable.
   */
  datesWithoutCloses: string[];
  /**
   * The oldest date the news lookup covered. Points before it show no stories
   * because the provider's search only returns recent coverage, not because
   * nothing happened — the UI should say so rather than imply a quiet day.
   */
  newsFromDate?: string;
  /** True when the news lookup failed or was skipped entirely. */
  newsUnavailable: boolean;
  /** True when the events lookup failed or was skipped entirely. */
  eventsUnavailable: boolean;
  /**
   * Events the provider reported that no close could be dated to, so they are
   * not on the chart. Counted rather than dropped silently.
   */
  unplottedEventCount: number;
}
