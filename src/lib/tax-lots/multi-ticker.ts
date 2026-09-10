// Analyzing several tickers at once, each with its own lots.
//
// This is a roll-up OF roll-ups, not a new calculation: each ticker runs through the
// same `analyzeAdhocLots` the single-ticker screen uses, and this file only sums
// across the results. Keeping it that way is what guarantees the per-ticker figures
// on the multi-ticker screen match the ones on the single-ticker screen exactly.
//
// What is deliberately NOT summed:
//
//   - **Blended cost basis.** Dollars per share of "NVDA and AAPL mixed" is not a
//     unit. A grand total that printed one would be a plausible-looking nonsense
//     number, which is worse than an absent one.
//   - **Long/short share counts.** Same reason: shares of different symbols do not
//     add up. Long/short *value* does, and that is what the total reports.
//
// What IS summed, and why it is legitimate: every dollar figure, and the XIRR. The
// cash flows are all the reader's own money with real dates on them, so solving one
// rate across the whole selection answers a real question — "what did this basket
// return?" — in a way a per-share average cannot.

import { analyzeAdhocLots } from "./tax-lots";
import type { PortfolioAnalysis } from "./tax-lots";
import type { MultiTickerLotsInput, TickerLotsInput } from "./schema";
import { buildCashFlows } from "./tax-lots";
import type { CashFlow } from "./types";
import { computeXirr } from "./xirr";

/** One ticker's slice of the multi-ticker screen. */
export interface TickerAnalysisSection {
  ticker: string;
  /** The price this ticker's lots were struck at. */
  currentMarketPrice: number;
  /** False when no held position supplied a price and the newest lot's was used. */
  hasLivePrice: boolean;
  analysis: PortfolioAnalysis;
}

/**
 * The figures that legitimately add up across different symbols.
 *
 * No `blendedCostBasis` and no share counts — see the note at the top of this file.
 * `tickerCount` and `lotCount` are here because "how much am I looking at?" is the
 * first thing a reader asks of a combined view.
 */
export interface MultiTickerTotals {
  tickerCount: number;
  lotCount: number;
  totalCapitalInvested: number;
  totalCurrentValue: number;
  totalGainDollars: number;
  /** Signed percent against `totalCapitalInvested`. 0 when nothing was invested. */
  totalGainPercent: number;
  /**
   * Money-weighted annual return across every purchase in the selection.
   * `undefined` when the solver could not converge — reported as "—", never as 0.
   */
  xirr?: number;
  longTermValue: number;
  shortTermValue: number;
  longTermLotCount: number;
  shortTermLotCount: number;
  /** Lots that are long-term AND in profit, across every ticker. */
  trimCandidateCount: number;
}

export interface MultiTickerAnalysis {
  sections: TickerAnalysisSection[];
  totals: MultiTickerTotals;
}

/** What one ticker needs to be priced. Resolved by the caller, which is the layer
 *  that can read positions; this file stays free of any repository. */
export interface TickerPricing {
  ticker: string;
  currentMarketPrice: number;
  hasLivePrice: boolean;
  trailingEPS: number;
}

/**
 * Sums the per-ticker results into the grand total.
 *
 * The XIRR is re-solved over the *combined* flow series rather than averaged from
 * the per-ticker rates — an average of rates weights a $500 position the same as a
 * $50,000 one and is simply the wrong answer. Rebuilding the flows and solving once
 * is both correct and the same code path each section already used.
 */
export function summarizeAcrossTickers(
  sections: TickerAnalysisSection[],
  today: string,
): MultiTickerTotals {
  const allLots = sections.flatMap((section) => section.analysis.lots);
  const totalCapitalInvested = allLots.reduce((sum, lot) => sum + lot.costBasis, 0);
  const totalCurrentValue = allLots.reduce((sum, lot) => sum + lot.currentValue, 0);
  const totalGainDollars = totalCurrentValue - totalCapitalInvested;
  const longTerm = allLots.filter((lot) => lot.taxClassification === "LONG_TERM");
  const shortTerm = allLots.filter((lot) => lot.taxClassification === "SHORT_TERM");

  // One flow series across every ticker: each purchase is an outflow on its own
  // date, and the whole selection's present value is the single terminal inflow.
  const flows: CashFlow[] = buildCashFlows(allLots, totalCurrentValue, today);

  return {
    tickerCount: sections.length,
    lotCount: allLots.length,
    totalCapitalInvested,
    totalCurrentValue,
    totalGainDollars,
    totalGainPercent:
      totalCapitalInvested > 0 ? (totalGainDollars / totalCapitalInvested) * 100 : 0,
    xirr: allLots.length > 0 ? computeXirr(flows) : undefined,
    longTermValue: longTerm.reduce((sum, lot) => sum + lot.currentValue, 0),
    shortTermValue: shortTerm.reduce((sum, lot) => sum + lot.currentValue, 0),
    longTermLotCount: longTerm.length,
    shortTermLotCount: shortTerm.length,
    trimCandidateCount: allLots.filter((lot) => lot.isTrimCandidate).length,
  };
}

/**
 * The whole multi-ticker analysis: every ticker scored on its own, then combined.
 *
 * Pricing arrives as a lookup rather than being fetched here, because this module
 * must not know how a price is found (a held position, a fallback, a flag) — that is
 * the caller's job, and it differs between the web section and the CLI. A ticker
 * with no pricing entry is priced at 0, which the section reports as an assumption
 * rather than silently showing a total loss.
 *
 * Sections come back in the order the tickers were passed, so the screen's dividers
 * follow the order the user picked them rather than an order this file invented.
 */
export function analyzeMultipleTickers(
  input: MultiTickerLotsInput,
  pricing: Map<string, TickerPricing>,
): MultiTickerAnalysis {
  const sections: TickerAnalysisSection[] = input.tickers.map((entry: TickerLotsInput) => {
    const priced = pricing.get(entry.ticker);
    // With no held position and no override, fall back to the newest lot passed in —
    // the same rule the single-ticker screen applies, so the two agree.
    const newest = [...entry.lots].sort((left, right) =>
      left.buyDate.localeCompare(right.buyDate),
    ).at(-1);
    const currentMarketPrice =
      priced?.currentMarketPrice || newest?.pricePerShare || 0;

    return {
      ticker: entry.ticker,
      currentMarketPrice,
      hasLivePrice: priced?.hasLivePrice ?? false,
      analysis: analyzeAdhocLots({
        ticker: entry.ticker,
        currentMarketPrice,
        trailingEPS: priced?.trailingEPS ?? 0,
        today: input.today,
        lots: entry.lots,
      }),
    };
  });

  return { sections, totals: summarizeAcrossTickers(sections, input.today) };
}
