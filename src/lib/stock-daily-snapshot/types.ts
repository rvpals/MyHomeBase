/** What the portfolio was worth on one calendar day, and how it moved that day. */
export interface DailySnapshot {
  /** Local-calendar "YYYY-MM-DD". Unique — one row per day. */
  snapshotDate: string;
  stockValueCents: number;
  etfValueCents: number;
  /** Bond, MutualFund, Crypto and Other, so the three parts sum to the total. */
  otherValueCents: number;
  totalValueCents: number;
  /** Signed — a down day is negative. */
  stockGainLossCents: number;
  etfGainLossCents: number;
  otherGainLossCents: number;
  totalGainLossCents: number;
  /** How many positions this row was computed from. */
  positionCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Which of the three buckets a position's value lands in. */
export type SnapshotBucket = "stock" | "etf" | "other";

/**
 * A week's, month's or year's worth of snapshots rolled up.
 *
 * `gainLossCents` sums the daily moves and is the honest performance number.
 * `valueChangeCents` differences the first and last day's value and will disagree
 * whenever money was added or withdrawn during the period — that difference is
 * informative, not a bug, so both are reported.
 */
export interface PeriodSummary {
  fromDate: string;
  toDate: string;
  /** Days that actually have a snapshot. A gap lowers this rather than being filled in. */
  dayCount: number;
  gainLossCents: number;
  startValueCents: number;
  endValueCents: number;
  valueChangeCents: number;
  /** `gainLossCents` against the starting value, as a percent. 0 when there's no starting value. */
  gainLossPct: number;
  upDays: number;
  downDays: number;
  bestDay?: { snapshotDate: string; gainLossCents: number };
  worstDay?: { snapshotDate: string; gainLossCents: number };
}
