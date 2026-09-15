/**
 * Turning the correlation matrix into the handful of facts an analysis can use.
 *
 * The matrix itself is already computed and cached elsewhere
 * (`src/lib/stock-analytics`, table `stk_stock_correlation_cache`); nothing here
 * fetches or recomputes it. This module answers three questions from it:
 *
 * - which holdings move together enough to be redundant,
 * - which move least together — the only real diversification already present,
 * - and which sectors the portfolio has no exposure to at all.
 *
 * Why summarise rather than ship the matrix: 49 holdings is 1,176 pairs. Pasted
 * into a prompt that is a wall of numbers the model will skim, and it crowds out
 * the holdings table that the rest of the analysis needs. The extremes are where
 * the decisions are.
 *
 * Pure: takes data, returns data. No I/O, no clock beyond the `now` a caller
 * passes for the staleness check.
 */

import type { CorrelationResult } from "@/lib/stock-analytics";
import type { CorrelationInsight, CorrelationPair, MarketCorrelationNote, SectorGap } from "./types";

/**
 * How many pairs each list carries.
 *
 * Ten is enough to show a pattern — three pairs all involving NVDA says
 * something one pair does not — and short enough that the reader can check
 * every line against the holdings table.
 */
export const MAX_PAIRS = 10;

/** Past this many days the cache is reported as stale, without being withheld. */
export const STALE_AFTER_DAYS = 7;

/**
 * The GICS sectors, as the sector labels in this app are spelled.
 *
 * Hard-coded because it is a standard, stable taxonomy — the eleven sectors have
 * not changed since Real Estate was split out in 2016 — not a universe of
 * securities that would need maintaining. It exists so the export can say "you
 * have no Utilities exposure at all", which is a statement about the *absence*
 * of a sector and therefore impossible to make from the holdings alone.
 */
export const GICS_SECTORS = [
  "Basic Materials",
  "Communication Services",
  "Consumer Cyclical",
  "Consumer Defensive",
  "Energy",
  "Financial Services",
  "Healthcare",
  "Industrials",
  "Real Estate",
  "Technology",
  "Utilities",
] as const;

/**
 * Sector labels that mean "this holding has no sector", not "this sector".
 *
 * A fund genuinely has none, so it must not be mistaken for a twelfth sector
 * when the gaps are worked out.
 */
const NON_SECTOR_LABELS = new Set(["Unclassified", "ETFs & funds", ""]);

/** Rounds to `places` decimals, avoiding float dust in the JSON rendering. */
function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** Whole days between an ISO timestamp and `now`. Negative clamps to 0. */
function daysSince(isoTimestamp: string, now: Date): number | null {
  const then = new Date(isoTimestamp);
  if (Number.isNaN(then.getTime())) return null;
  const days = (now.getTime() - then.getTime()) / 86_400_000;
  return days < 0 ? 0 : Math.floor(days);
}

/**
 * How a correlation reads in words.
 *
 * Banded rather than left as a bare number because the number alone invites the
 * model to call 0.35 "a hedge". These labels are the vocabulary the prompt then
 * reuses, so the write-up and the data agree.
 */
export function describeCorrelation(value: number): string {
  if (value <= -0.3) return "inverse";
  if (value < 0) return "slightly inverse";
  if (value < 0.3) return "largely independent";
  if (value < 0.6) return "loosely coupled";
  if (value < 0.85) return "strongly coupled";
  return "nearly identical";
}

/**
 * Every unique pair in the matrix, as flat records.
 *
 * Reads only the upper triangle (`j > i`): the matrix is symmetric, so the lower
 * half is the same pairs again and would make every "top pair" a duplicate.
 * A ticker present in the matrix but no longer in `heldTickers` is skipped —
 * a stale cache can still name a position that has since been sold, and
 * recommending action on it would be wrong.
 */
function allPairs(
  correlation: CorrelationResult,
  heldTickers: ReadonlySet<string> | undefined,
  weightByTicker: ReadonlyMap<string, number>,
): CorrelationPair[] {
  const { tickers, matrix } = correlation;
  const pairs: CorrelationPair[] = [];

  /**
   * The matrix is built from *positions*, so a ticker held in two accounts
   * appears twice in `tickers` — MSFT sits in both the taxable and the Roth
   * account in this portfolio. Those two columns are the same security, so the
   * pair correlates at exactly 1.000 and would otherwise top the redundancy
   * table as pure noise. Deduplicating by ticker is what makes the table mean
   * "two different things that move together".
   */
  const seenPairs = new Set<string>();

  for (let i = 0; i < tickers.length; i += 1) {
    const rowA = matrix[i];
    if (!rowA) continue;
    const tickerA = tickers[i].toUpperCase();
    if (heldTickers && !heldTickers.has(tickerA)) continue;

    for (let j = i + 1; j < tickers.length; j += 1) {
      const tickerB = tickers[j].toUpperCase();
      if (heldTickers && !heldTickers.has(tickerB)) continue;
      if (tickerA === tickerB) continue;

      // Order-independent, so A-B and a later B-A count as one pair.
      const pairKey = tickerA < tickerB ? `${tickerA}|${tickerB}` : `${tickerB}|${tickerA}`;
      if (seenPairs.has(pairKey)) continue;

      const value = rowA[j];
      // A ragged matrix is a corrupt cache, not a zero correlation.
      if (typeof value !== "number" || Number.isNaN(value)) continue;

      seenPairs.add(pairKey);
      pairs.push({
        tickerA,
        tickerB,
        correlation: round(value, 3),
        label: describeCorrelation(value),
        combinedWeightPct: round(
          (weightByTicker.get(tickerA) ?? 0) + (weightByTicker.get(tickerB) ?? 0),
          2,
        ),
      });
    }
  }

  return pairs;
}

/** The SPY correlations worth naming: the most and least market-driven holdings. */
function marketNotes(
  correlation: CorrelationResult,
  heldTickers: ReadonlySet<string> | undefined,
): MarketCorrelationNote[] {
  const notes: MarketCorrelationNote[] = [];

  for (const [rawTicker, value] of Object.entries(correlation.marketCorrelation)) {
    if (value === null || typeof value !== "number" || Number.isNaN(value)) continue;
    const ticker = rawTicker.toUpperCase();
    if (heldTickers && !heldTickers.has(ticker)) continue;
    notes.push({ ticker, correlation: round(value, 3), label: describeCorrelation(value) });
  }

  return notes.sort((a, b) => b.correlation - a.correlation);
}

/**
 * Which sectors the portfolio holds nothing in, and which it barely holds.
 *
 * "Thin" is under 3% of the portfolio: enough to appear in the sector chart,
 * not enough to affect the portfolio's behaviour. Both lists matter to the
 * question being asked — a sector held at 0.4% is a gap that looks filled.
 */
export function findSectorGaps(
  sectorWeights: ReadonlyMap<string, number>,
  thinThresholdPct = 3,
): SectorGap[] {
  const normalized = new Map<string, number>();
  for (const [sector, weight] of sectorWeights) {
    if (NON_SECTOR_LABELS.has(sector)) continue;
    normalized.set(sector, (normalized.get(sector) ?? 0) + weight);
  }

  return GICS_SECTORS.filter((sector) => (normalized.get(sector) ?? 0) < thinThresholdPct)
    .map((sector) => {
      const weightPct = round(normalized.get(sector) ?? 0, 2);
      return {
        sector,
        weightPct,
        status: weightPct === 0 ? ("absent" as const) : ("thin" as const),
      };
    })
    .sort((a, b) => a.weightPct - b.weightPct);
}

export interface SummarizeCorrelationsInput {
  correlation: CorrelationResult;
  /** Ticker → portfolio weight %, so a pair can say how much money it involves. */
  weightByTicker: ReadonlyMap<string, number>;
  /**
   * The tickers still held. A stale cache can name a sold position, and advice
   * about one is worse than no advice. Omit to trust the matrix as given.
   */
  heldTickers?: ReadonlySet<string>;
  /** Ticker → sector, for the gap analysis. */
  sectorWeights: ReadonlyMap<string, number>;
  now?: Date;
}

/**
 * The correlation facts the prompt and the renderers read.
 *
 * Returns `undefined` when the matrix cannot support a statement — fewer than
 * two usable pairs means there is nothing to compare, and an empty section is
 * more honest than one built from a single number.
 */
export function summarizeCorrelations(
  input: SummarizeCorrelationsInput,
): CorrelationInsight | undefined {
  const { correlation, weightByTicker, heldTickers, sectorWeights } = input;
  const now = input.now ?? new Date();

  const pairs = allPairs(correlation, heldTickers, weightByTicker);
  if (pairs.length === 0) return undefined;

  // Sorted once, then read from both ends.
  const byCorrelation = [...pairs].sort(
    (a, b) => b.correlation - a.correlation || a.tickerA.localeCompare(b.tickerA),
  );

  // The two lists must not overlap. Taking MAX_PAIRS from each end would list
  // the same pair as both "most correlated" and "least correlated" whenever
  // there are fewer than 2 * MAX_PAIRS pairs — and with only three pairs, every
  // pair would appear in both tables, so a -0.12 pair would be presented as a
  // redundancy candidate. Splitting at the midpoint keeps each pair on the side
  // it actually belongs to.
  // A lone pair is the strongest and the weakest link at once; it belongs in the
  // "most correlated" table, where the redundancy question is asked, and the
  // other table stays empty rather than repeating it.
  const half = Math.min(MAX_PAIRS, Math.floor(byCorrelation.length / 2));
  const mostCorrelated = byCorrelation.slice(0, half === 0 ? 1 : half);
  const leastCorrelated = half === 0 ? [] : byCorrelation.slice(-half).reverse();

  const averagePairwise =
    pairs.reduce((sum, pair) => sum + pair.correlation, 0) / pairs.length;

  const staleDays = daysSince(correlation.calculatedAt, now);

  return {
    calculatedAt: correlation.calculatedAt,
    ageDays: staleDays,
    isStale: staleDays === null ? true : staleDays > STALE_AFTER_DAYS,
    // Distinct securities, not matrix columns: a ticker held in two accounts
    // occupies two columns but is one holding.
    tickerCount: new Set(pairs.flatMap((pair) => [pair.tickerA, pair.tickerB])).size,
    pairCount: pairs.length,
    averagePairwiseCorrelation: round(averagePairwise, 3),
    mostCorrelated,
    leastCorrelated,
    marketCorrelations: marketNotes(correlation, heldTickers),
    /** Non-empty only when a holding could not be fetched at compute time. */
    excludedTickers: [...correlation.failedTickers].map((ticker) => ticker.toUpperCase()).sort(),
    sectorGaps: findSectorGaps(sectorWeights),
    /**
     * Whether anything in the portfolio is genuinely inversely correlated.
     * Read by the prompt so it can state the fact instead of implying a hedge
     * that does not exist — across US equities over one year, almost nothing is.
     */
    hasInverseCorrelation: pairs.some((pair) => pair.correlation < 0),
  };
}
