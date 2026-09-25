// The board's second pass: the reference figures that cost an extra call.
//
// Split from `market-indexes.ts` because the two passes have different costs
// and different failure rules. The first pass is one cheap unauthenticated
// quote per symbol and its result *is* the card. This pass adds a quoteSummary
// (which needs the crumb/cookie dance) and an intraday history call on top —
// three times the requests for figures the reader can live without. So every
// failure here is swallowed: a symbol that can't be enriched keeps the row it
// already had, and the card draws an em-dash where the extras would go.
//
// Nothing here fetches on its own behalf. `enrichIndexQuote` is pure and takes
// the two payloads; `loadIndexDetail` is the only part that touches a client.

import { cents, pct } from "@/lib/ticker-detail";
import {
  getPriceHistory,
  type MarketDataClient,
  type PricePoint,
  type QuoteSummaryClient,
  type RawQuoteSummary,
} from "@/lib/market-data";
import type { IndexQuote, IndexQuoteDetail } from "./types";

/**
 * The intraday window the sparkline draws.
 *
 * 5-minute bars, measured rather than guessed (2026-09-24): across the eleven
 * symbols this yields ~78 points for a full US equity session and ~290 for a
 * 24/7 crypto series. `1m` returns up to 971, which no 112px-wide sparkline can
 * resolve — it costs bandwidth to draw the same shape.
 */
export const INTRADAY_RANGE = "1d";
export const INTRADAY_INTERVAL = "5m";

/**
 * Fold the provider's two payloads into the detail block.
 *
 * Pure, so the mapping is testable without a network. Unwrapping goes through
 * `ticker-detail`'s `num`/`cents`/`pct` helpers rather than a second local copy:
 * Yahoo wraps numbers as `{ raw, fmt }` about half the time, those helpers
 * already handle both shapes, and the percentage convention (0.1762 becomes
 * 17.62) has to match what the rest of the app prints.
 */
export function enrichIndexQuote(
  summary: RawQuoteSummary | undefined,
  history: PricePoint[],
): IndexQuoteDetail {
  const detailSection = summary?.summaryDetail;
  const stats = summary?.defaultKeyStatistics;

  return {
    fiftyTwoWeekLowCents: cents(detailSection?.fiftyTwoWeekLow),
    fiftyTwoWeekHighCents: cents(detailSection?.fiftyTwoWeekHigh),
    // From `defaultKeyStatistics`, which is the module that comes back empty
    // for the commodity futures — hence this one field being absent on three
    // rows while everything around it is present.
    oneYearChangePct: pct(stats?.["52WeekChange"]),
    fiftyDayAverageCents: cents(detailSection?.fiftyDayAverage),
    twoHundredDayAverageCents: cents(detailSection?.twoHundredDayAverage),
    allTimeHighCents: cents(detailSection?.allTimeHigh),
    intradayCents: history.map((point) => point.closeCents),
  };
}

/**
 * Where today's level sits in its 52-week range, 0 (at the low) to 100 (at the
 * high), or undefined when the range isn't known.
 *
 * Clamped because the two numbers come from different calls a moment apart: a
 * level that has just made a new high arrives before the 52-week high catches
 * up, which would otherwise place the marker past the end of its own track.
 * A zero-width range (low equals high) reads as 50 rather than dividing by zero.
 */
export function rangePosition(
  valueCents: number,
  lowCents: number | undefined,
  highCents: number | undefined,
): number | undefined {
  if (lowCents === undefined || highCents === undefined) return undefined;
  const span = highCents - lowCents;
  if (span <= 0) return 50;
  return Math.min(100, Math.max(0, ((valueCents - lowCents) / span) * 100));
}

/**
 * Fetch and attach the detail for one symbol.
 *
 * Both legs are independent and neither is allowed to fail the row: the
 * sparkline is worth having without the 52-week range and vice versa, so they
 * settle separately rather than through one `Promise.all` that loses both when
 * either rejects.
 */
export async function loadIndexDetail(
  clients: { marketData: MarketDataClient; quoteSummary: QuoteSummaryClient },
  quote: IndexQuote,
): Promise<IndexQuote> {
  const [summary, history] = await Promise.all([
    clients.quoteSummary.getQuoteSummary(quote.symbol).catch(() => undefined),
    // Through the use-case, not `client.getHistory` directly, so the request is
    // validated by market-data's own schema exactly as every other caller's is.
    getPriceHistory(clients.marketData, quote.symbol, INTRADAY_RANGE, INTRADAY_INTERVAL).catch(
      (): PricePoint[] => [],
    ),
  ]);

  // Both legs failing means there is nothing to attach. Leaving `detail`
  // undefined rather than attaching an all-empty block keeps "we didn't ask"
  // and "we asked and got nothing" looking the same to the view, which is the
  // contract `IndexQuoteDetail` documents.
  if (summary === undefined && history.length === 0) return quote;

  return { ...quote, detail: enrichIndexQuote(summary, history) };
}
