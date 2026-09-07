// Corporate-action normalization. Zero dependencies, pure functions.
//
// The rule that drives everything in this file: a split that took effect AFTER you
// bought applies to your lot; one that took effect on or before your buy date is
// already baked into the price you paid. So the factor for a lot is the product of
// the ratios of every split strictly later than its buy date.
//
// Dates are compared as ISO strings. That is not laziness — `YYYY-MM-DD` sorts
// lexicographically in the same order it sorts chronologically, so string comparison
// is exact and sidesteps every timezone question a `Date` would introduce.

import type { NormalizedLot, RawLot, SplitHistory, StockSplit } from "./types";

/**
 * Known splits, hand-maintained, newest ticker last. Authoritative: the market-data
 * client can also report split events, but a fetched value is a suggestion to add a
 * row here, not a substitute for one — an analyzer whose cost basis silently changes
 * when a provider revises its history is worse than one you have to update by hand.
 *
 * Ratios are new-per-old, so a reverse split is a fraction (see `StockSplit.ratio`).
 */
const SPLIT_TABLE: Record<string, StockSplit[]> = {
  NVDA: [
    { effectiveDate: "2021-07-20", ratio: 4, label: "4:1" },
    { effectiveDate: "2024-06-07", ratio: 10, label: "10:1" },
  ],
  AAPL: [
    { effectiveDate: "2014-06-09", ratio: 7, label: "7:1" },
    { effectiveDate: "2020-08-31", ratio: 4, label: "4:1" },
  ],
  TSLA: [
    { effectiveDate: "2020-08-31", ratio: 5, label: "5:1" },
    { effectiveDate: "2022-08-25", ratio: 3, label: "3:1" },
  ],
  AMZN: [{ effectiveDate: "2022-06-06", ratio: 20, label: "20:1" }],
  GOOGL: [{ effectiveDate: "2022-07-18", ratio: 20, label: "20:1" }],
  MSFT: [{ effectiveDate: "2003-02-18", ratio: 2, label: "2:1" }],
};

/** Every ticker the split table knows about. Sorted, for a stable picker. */
export function tickersWithSplits(): string[] {
  return Object.keys(SPLIT_TABLE).sort();
}

/**
 * The split history for a ticker. A ticker with no known splits gets an empty
 * history rather than `undefined` — "never split" is an answer, not a miss, and it
 * lets every caller treat the result the same way.
 */
export function splitHistoryFor(ticker: string): SplitHistory {
  const symbol = ticker.trim().toUpperCase();
  return { ticker: symbol, splits: SPLIT_TABLE[symbol] ?? [] };
}

/**
 * The product of every split effective strictly after `buyDate`.
 *
 * Strictly after is the whole subtlety. A lot bought ON the effective date already
 * trades in post-split shares, so including that split would double-count it and
 * report four times the shares actually held.
 */
export function cumulativeSplitFactor(buyDate: string, history: SplitHistory): number {
  return history.splits.reduce(
    (factor, split) => (split.effectiveDate > buyDate ? factor * split.ratio : factor),
    1,
  );
}

/** The splits that apply to a lot bought on `buyDate`, oldest first. Display only. */
export function splitsAppliedTo(buyDate: string, history: SplitHistory): StockSplit[] {
  return history.splits
    .filter((split) => split.effectiveDate > buyDate)
    .sort((left, right) => left.effectiveDate.localeCompare(right.effectiveDate));
}

/**
 * Restates a raw lot in today's shares.
 *
 * Shares multiply by the factor and price divides by it, so `costBasis` comes out
 * identical to `rawShares * rawPrice` — the split moved no money. Floating-point
 * multiplication then division is not bit-exact, so the tests assert the identity
 * with `toBeCloseTo` rather than `toBe`.
 */
export function normalizeLot(lot: RawLot, history: SplitHistory): NormalizedLot {
  const factor = cumulativeSplitFactor(lot.buyDate, history);
  const adjustedShares = lot.rawShares * factor;
  const adjustedCostPerShare = lot.rawPrice / factor;

  return {
    ...lot,
    cumulativeSplitFactor: factor,
    adjustedShares,
    adjustedCostPerShare,
    costBasis: adjustedShares * adjustedCostPerShare,
  };
}

/**
 * A lot whose entered numbers are ALREADY post-split, wrapped in the same shape.
 *
 * The factor is reported as 1 and nothing is scaled. This exists so the stored
 * `isSplitAdjusted` flag has one honest destination: the alternative — skipping
 * `normalizeLot` at the call site — would leave callers branching on the flag and
 * building the result object twice.
 */
export function passthroughLot(lot: RawLot): NormalizedLot {
  return {
    ...lot,
    cumulativeSplitFactor: 1,
    adjustedShares: lot.rawShares,
    adjustedCostPerShare: lot.rawPrice,
    costBasis: lot.rawShares * lot.rawPrice,
  };
}
