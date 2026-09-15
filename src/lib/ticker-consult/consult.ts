/**
 * Turns what MyHomeBase knows about one symbol into the input the consult
 * prompt is written from.
 *
 * The only arithmetic here is the price band and a handful of sums the viewer's
 * own totals don't already carry. Everything else is a projection: this module
 * chooses *which* of the many figures on `TickerOwnData` an alternatives search
 * actually needs, and drops the rest so the prompt stays readable.
 */

import { todayIsoLocal } from "@/lib/shared/date";
import { transactionDate, type TickerOwnData, type TickerQuote } from "@/lib/ticker-overview";
import {
  DEFAULT_TOLERANCE_PCT,
  type ConsultTrade,
  type PriceBand,
  type ReferencePrice,
  type TickerConsultInput,
  type TickerConsultPrompt,
} from "./types";
import { buildTickerConsultPrompt } from "./prompt";

/** What the caller hands in. Only `ownData` is required. */
export interface BuildConsultInput {
  ticker: string;
  ownData: TickerOwnData;
  /** The live quote, when the Market tab has loaded one. */
  quote?: TickerQuote;
  /** The provider's company profile figures, when the detail has loaded. */
  sector?: string;
  industry?: string;
  /** Overridable for tests; defaults to 15%. */
  tolerancePct?: number;
  /** Overridable for tests. */
  now?: Date;
}

/**
 * Whether the quote was still moving when it was read.
 *
 * A quote whose price differs from its own previous close is, by definition, a
 * price the session has already moved off — so the session is open, or was when
 * the provider answered. An exact match means the day's move is zero, which is
 * far more likely to be a market that never opened (or has settled) than a real
 * flat close, so it is reported as a `close`.
 *
 * Deliberately not a clock-and-holiday-calendar decision: this app has no
 * market calendar, and inventing one to label a single line of a prompt would be
 * a much larger and less reliable thing than reading the number the provider
 * already gave. The label only has to be honest about which figure it is.
 */
function classifyQuote(quote: TickerQuote): ReferencePrice {
  const moved = quote.previousCloseCents > 0 && quote.priceCents !== quote.previousCloseCents;
  return {
    cents: quote.priceCents,
    source: moved ? "intraday" : "close",
    asOf: quote.fetchedAt,
  };
}

/**
 * The price the band is anchored on.
 *
 * Prefers the provider's quote and falls back to the price on our own position
 * row — the same preference the viewer's header makes, so the prompt and the
 * dialog behind it can never disagree about what this share is worth. A
 * fallback is labelled `recorded` rather than passed off as a close, because it
 * is whatever the last import or refresh wrote and may be days old.
 */
function referencePrice(input: BuildConsultInput, now: Date): ReferencePrice {
  if (input.quote && input.quote.priceCents > 0) return classifyQuote(input.quote);

  const recorded =
    input.ownData.holdings[0]?.currentPriceCents ?? input.ownData.trades.currentPriceCents;

  return {
    cents: recorded > 0 ? recorded : 0,
    source: "recorded",
    asOf: input.ownData.lastUpdatedAt ?? now.toISOString(),
  };
}

/**
 * The ±`tolerancePct` band around `cents`.
 *
 * Rounded to whole cents so the two figures in the prompt are prices a reader
 * could actually see quoted, and so a test can assert them exactly.
 */
export function priceBand(cents: number, tolerancePct: number): PriceBand {
  const spread = (cents * tolerancePct) / 100;
  return {
    tolerancePct,
    lowCents: Math.max(0, Math.round(cents - spread)),
    highCents: Math.round(cents + spread),
  };
}

/** A trade row reduced to the fields the analysis needs, oldest first. */
function tradeHistory(ownData: TickerOwnData) {
  const { trades } = ownData;

  // `transactions` is newest first (it is a table); a prompt reads better as the
  // story of a position being built, so it is reversed here rather than in the
  // prompt writer.
  const rows: ConsultTrade[] = [...trades.transactions]
    .reverse()
    .map((transaction) => ({
      // The module's own helper, not a `new Date(...)` slice. A trade stored as
      // midnight UTC would shift to the previous day in a negative-offset
      // timezone, which would date a purchase to a day it didn't happen on.
      date: transactionDate(transaction.transactionAt),
      action: transaction.action,
      numberOfShares: transaction.numberOfShares,
      pricePerShareCents: transaction.pricePerShareCents,
      totalAmountCents: transaction.totalAmountCents,
      brokerageFirm: transaction.brokerageFirm,
    }));

  return {
    trades: rows,
    buyCount: trades.buyCount,
    sellCount: trades.sellCount,
    sharesBought: trades.sharesBought,
    sharesSold: trades.sharesSold,
    totalBoughtCents: trades.totalBoughtCents,
    totalSoldCents: trades.totalSoldCents,
    firstTradeDate: trades.firstTradeAt ? transactionDate(trades.firstTradeAt) : undefined,
    lastTradeDate: trades.lastTradeAt ? transactionDate(trades.lastTradeAt) : undefined,
  };
}

/** Projects the viewer's own-data record into the consult input. */
export function buildTickerConsultInput(input: BuildConsultInput): TickerConsultInput {
  const now = input.now ?? new Date();
  const { ownData } = input;
  const reference = referencePrice(input, now);

  return {
    ticker: input.ticker,
    name: ownData.name || input.quote?.shortName || "",
    sector: input.sector,
    industry: input.industry,
    referencePrice: reference,
    band: priceBand(reference.cents, input.tolerancePct ?? DEFAULT_TOLERANCE_PCT),
    position: {
      isHeld: ownData.isHeld,
      isWatched: ownData.isWatched,
      quantity: ownData.totals.quantity,
      accountCount: ownData.totals.accountCount,
      costCents: ownData.totals.costCents,
      averageUnitCostCents: ownData.totals.averageUnitCostCents,
      valueCents: ownData.totals.valueCents,
      unrealizedGainLossCents: ownData.totals.unrealizedGainLossCents,
      totalReturnPct: ownData.totals.totalReturnPct,
      // The one figure the viewer's totals can't be read for directly: a summed
      // basis of 0 means "no account reported one", and the difference between
      // that and a real zero decides whether the return figures mean anything.
      hasCostBasis: ownData.totals.costCents > 0,
      portfolioWeightPct: ownData.portfolioWeight.weightPct,
      holdings: ownData.holdings.map((holding) => ({
        accountName: holding.accountName,
        quantity: holding.quantity,
        costCents: holding.costCents,
        unitCostCents: holding.unitCostCents,
        valueCents: holding.valueCents,
      })),
    },
    history: tradeHistory(ownData),
  };
}

/** The suggested download name. Dated so two consults don't overwrite each other. */
export function consultFileName(ticker: string, now: Date = new Date()): string {
  return `${ticker.toUpperCase()}-ai-consult-${todayIsoLocal(now)}.md`;
}

/**
 * The whole use-case: project the records, write the prompt, name the file.
 *
 * One call so the web dialog and the CLI command produce byte-identical text —
 * which is the point of it living here rather than in either adapter.
 */
export function buildTickerConsult(input: BuildConsultInput): TickerConsultPrompt {
  const now = input.now ?? new Date();
  const consultInput = buildTickerConsultInput({ ...input, now });

  return {
    ticker: consultInput.ticker,
    content: buildTickerConsultPrompt(consultInput),
    fileName: consultFileName(consultInput.ticker, now),
  };
}
