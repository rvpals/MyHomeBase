// The Tax Lot Portfolio Analyzer's use-cases and per-lot maths.
//
// Split into two halves, deliberately:
//
//  - Pure calculation (`analyzeLot` … `analyzePortfolio`) takes data and returns
//    data. No repository, no clock — `today` is always a parameter, because a
//    function that reads the clock cannot be tested at a date boundary, and every
//    figure here turns on exactly that boundary (the one-year long/short line).
//  - Repository-backed CRUD (`listTaxLots` … `deleteTaxLot`) takes a port.
//
// Money crosses the storage boundary as integer cents, matching every other money
// column in the schema, and is converted to dollars once on the way in. The maths
// then runs in dollars so the formulas read exactly as specified.

import { centsToDollars, dollarsToCents } from "../shared/money";
import { normalizeLot, passthroughLot, splitHistoryFor } from "./splits";
import type {
  AdhocLotInput,
  AnalyzeAdhocLotsInput,
  CreateTaxLotInput,
  SaveAdhocLotsInput,
  UpdateTaxLotInput,
} from "./schema";
import type { TaxLotRepository } from "./ports";
import type {
  CashFlow,
  LotPerformance,
  NormalizedLot,
  PortfolioLotSummary,
  RawLot,
  TaxClassification,
  TaxLot,
} from "./types";
import { computeXirr } from "./xirr";

/** Calendar length of a year, including the leap-year quarter-day. */
const DAYS_PER_YEAR = 365.25;
const MILLISECONDS_PER_DAY = 86_400_000;

/** The IRS long-term capital-gains threshold, in years. */
const LONG_TERM_YEARS = 1.0;

/** What a lot needs to be scored. `trailingEPS` is 0 when the figure is unknown. */
export interface LotAnalysisContext {
  ticker: string;
  currentMarketPrice: number;
  /** Trailing earnings per share, in dollars. 0 means unknown — yields report 0. */
  trailingEPS: number;
  /** ISO date (YYYY-MM-DD) to measure holding periods against. */
  today: string;
}

/**
 * Whole days between two ISO dates, as a fraction of a year.
 *
 * Clamped at 0: a lot dated in the future (a typo, or a trade entered ahead of
 * settlement) would otherwise report a negative holding period and be classified
 * short-term with a nonsensical CAGR. Parsed as UTC midnight on both sides so the
 * difference is an exact multiple of a day regardless of the server's timezone.
 */
export function yearsBetween(fromIsoDate: string, toIsoDate: string): number {
  const from = Date.parse(`${fromIsoDate}T00:00:00Z`);
  const to = Date.parse(`${toIsoDate}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max((to - from) / MILLISECONDS_PER_DAY / DAYS_PER_YEAR, 0);
}

/** Long-term at exactly one year and beyond — the threshold is inclusive. */
export function classifyHoldingPeriod(yearsHeld: number): TaxClassification {
  return yearsHeld >= LONG_TERM_YEARS ? "LONG_TERM" : "SHORT_TERM";
}

/**
 * Compound annual growth rate as a fraction, from cost per share to today's price.
 *
 * 0 for a lot held less than a day: annualizing a return earned over zero elapsed
 * time is a division by zero, and the honest answer to "what is this per year?" when
 * there has been no year is "not yet meaningful".
 */
export function computeCagr(
  adjustedCostPerShare: number,
  currentMarketPrice: number,
  yearsHeld: number,
): number {
  if (yearsHeld <= 0 || adjustedCostPerShare <= 0) return 0;
  return (currentMarketPrice / adjustedCostPerShare) ** (1 / yearsHeld) - 1;
}

/** Yield on cost as a percent. 0 when either side is unknown. */
export function computeYieldOnCost(trailingEPS: number, adjustedCostPerShare: number): number {
  if (adjustedCostPerShare <= 0) return 0;
  return (trailingEPS / adjustedCostPerShare) * 100;
}

/**
 * Restates a stored lot in today's shares, honouring its `isSplitAdjusted` flag.
 *
 * The flag is the reason this is not just `normalizeLot`: a lot entered from a
 * modern broker export is already post-split, and applying the split table to it
 * again would multiply shares that were never historical.
 */
export function normalizeStoredLot(lot: TaxLot): NormalizedLot {
  const raw: RawLot = {
    buyDate: lot.buyDate,
    rawShares: lot.shares,
    rawPrice: centsToDollars(lot.pricePerShareCents),
  };
  return lot.isSplitAdjusted ? passthroughLot(raw) : normalizeLot(raw, splitHistoryFor(lot.ticker));
}

/** Scores one already-normalized lot against the current price. */
export function analyzeNormalizedLot(
  lot: NormalizedLot,
  context: LotAnalysisContext,
  id?: number,
): LotPerformance {
  const currentValue = lot.adjustedShares * context.currentMarketPrice;
  const unrealizedGainDollars = currentValue - lot.costBasis;
  const unrealizedGainPercent =
    lot.costBasis > 0 ? (unrealizedGainDollars / lot.costBasis) * 100 : 0;
  const yearsHeld = yearsBetween(lot.buyDate, context.today);
  const taxClassification = classifyHoldingPeriod(yearsHeld);

  return {
    ...lot,
    id,
    ticker: context.ticker,
    currentValue,
    unrealizedGainDollars,
    unrealizedGainPercent,
    yearsHeld,
    cagr: computeCagr(lot.adjustedCostPerShare, context.currentMarketPrice, yearsHeld),
    yieldOnCost: computeYieldOnCost(context.trailingEPS, lot.adjustedCostPerShare),
    taxClassification,
    isTrimCandidate: taxClassification === "LONG_TERM" && unrealizedGainDollars > 0,
  };
}

/** Normalizes and scores one stored lot. */
export function analyzeLot(lot: TaxLot, context: LotAnalysisContext): LotPerformance {
  return analyzeNormalizedLot(normalizeStoredLot(lot), context, lot.id);
}

/**
 * The cash-flow series the XIRR is solved on: one outflow per purchase, and a single
 * terminal inflow for what the position is worth today.
 *
 * The terminal inflow is the standard treatment of an open position — you value it
 * as if you sold at today's price, which is what makes the return comparable to a
 * closed one. Purchases are negative because the money left your pocket.
 */
export function buildCashFlows(
  lots: LotPerformance[],
  totalCurrentValue: number,
  today: string,
): CashFlow[] {
  const flows: CashFlow[] = lots.map((lot) => ({ date: lot.buyDate, amount: -lot.costBasis }));
  flows.push({ date: today, amount: totalCurrentValue });
  return flows;
}

/** Rolls scored lots up into the portfolio figures the metric cards show. */
export function summarizePortfolio(
  lots: LotPerformance[],
  context: LotAnalysisContext,
): PortfolioLotSummary {
  const totalAdjustedShares = lots.reduce((sum, lot) => sum + lot.adjustedShares, 0);
  const totalCapitalInvested = lots.reduce((sum, lot) => sum + lot.costBasis, 0);
  const totalCurrentValue = lots.reduce((sum, lot) => sum + lot.currentValue, 0);
  const totalGainDollars = totalCurrentValue - totalCapitalInvested;
  const blendedCostBasis = totalAdjustedShares > 0 ? totalCapitalInvested / totalAdjustedShares : 0;
  const longTerm = lots.filter((lot) => lot.taxClassification === "LONG_TERM");
  const shortTerm = lots.filter((lot) => lot.taxClassification === "SHORT_TERM");

  return {
    ticker: context.ticker,
    lotCount: lots.length,
    totalAdjustedShares,
    totalCapitalInvested,
    totalCurrentValue,
    totalGainDollars,
    totalGainPercent:
      totalCapitalInvested > 0 ? (totalGainDollars / totalCapitalInvested) * 100 : 0,
    blendedCostBasis,
    blendedYieldOnCost: computeYieldOnCost(context.trailingEPS, blendedCostBasis),
    // Only solved when there is something to solve: no lots means no flows.
    xirr:
      lots.length > 0
        ? computeXirr(buildCashFlows(lots, totalCurrentValue, context.today))
        : undefined,
    longTermLotCount: longTerm.length,
    longTermValue: longTerm.reduce((sum, lot) => sum + lot.currentValue, 0),
    shortTermLotCount: shortTerm.length,
    shortTermValue: shortTerm.reduce((sum, lot) => sum + lot.currentValue, 0),
    currentMarketPrice: context.currentMarketPrice,
  };
}

export interface PortfolioAnalysis {
  lots: LotPerformance[];
  summary: PortfolioLotSummary;
}

/**
 * The whole analysis for one ticker: every lot scored, and the roll-up.
 *
 * Lots come back oldest first, which is both the order a tax-lot statement uses and
 * the order FIFO would sell them in. The grid can re-sort from there.
 */
export function analyzePortfolio(lots: TaxLot[], context: LotAnalysisContext): PortfolioAnalysis {
  const scored = lots
    .map((lot) => analyzeLot(lot, context))
    .sort((left, right) => left.buyDate.localeCompare(right.buyDate));
  return { lots: scored, summary: summarizePortfolio(scored, context) };
}

/* ---------------------------------------------------------------------------------
   Repository-backed use-cases. Each takes the port, never the concrete class.
--------------------------------------------------------------------------------- */

/** Every stored lot, or only one ticker's when `ticker` is given. */
export function listTaxLots(repo: TaxLotRepository, ticker?: string): TaxLot[] {
  return repo.listLots(ticker ? ticker.trim().toUpperCase() : undefined);
}

/** Every ticker that has at least one lot, for the analyzer's ticker picker. */
export function listTaxLotTickers(repo: TaxLotRepository): string[] {
  return repo.listTickers();
}

export function getTaxLot(repo: TaxLotRepository, id: number): TaxLot | undefined {
  return repo.getLotById(id);
}

export function createTaxLot(repo: TaxLotRepository, input: CreateTaxLotInput): TaxLot {
  return repo.createLot(input);
}

/** Updates a lot, or throws when the id does not exist. */
export function updateTaxLot(repo: TaxLotRepository, id: number, input: UpdateTaxLotInput): TaxLot {
  if (!repo.getLotById(id)) throw new Error(`No tax lot with id ${id}.`);
  return repo.updateLot(id, input);
}

/** Deletes a lot, or throws when the id does not exist. */
export function deleteTaxLot(repo: TaxLotRepository, id: number): void {
  if (!repo.getLotById(id)) throw new Error(`No tax lot with id ${id}.`);
  repo.deleteLot(id);
}

/**
 * The analyzer screen's one read: load a ticker's lots and score them.
 *
 * A use-case rather than two calls from the page, so the CLI and the web app run
 * exactly the same thing — this is the function both adapters drive.
 */
export function analyzeTicker(
  repo: TaxLotRepository,
  context: LotAnalysisContext,
): PortfolioAnalysis {
  return analyzePortfolio(listTaxLots(repo, context.ticker), context);
}

/* ---------------------------------------------------------------------------------
   Ad-hoc analysis. Transactions in, aggregate out, nothing stored.
--------------------------------------------------------------------------------- */

/**
 * Restates an ad-hoc transaction as the in-memory `TaxLot` the maths already takes.
 *
 * `id` is deliberately 0: nothing was stored, so there is no row to edit or delete,
 * and the view keys off it to hide those actions. The timestamps are empty for the
 * same reason — an ad-hoc lot has no creation history to report.
 */
function toUnsavedLot(ticker: string, lot: AdhocLotInput): TaxLot {
  return {
    id: 0,
    ticker,
    buyDate: lot.buyDate,
    shares: lot.shares,
    // Dollars in, cents stored: the one conversion, done here rather than in three
    // adapters, so the URL, the form and the CLI flag all round the same way.
    pricePerShareCents: dollarsToCents(lot.pricePerShare),
    isSplitAdjusted: lot.isSplitAdjusted,
    brokerageFirm: lot.brokerageFirm,
    note: lot.note,
    createdAt: "",
    updatedAt: "",
  };
}

/**
 * Scores a set of passed-in transactions and rolls them up.
 *
 * No repository parameter, because there is no storage in this path — which is what
 * makes it callable from a URL, a form keystroke and a CLI flag alike. Every figure
 * comes from `analyzePortfolio`, the same function the stored screen uses, so a
 * saved lot and an ad-hoc one with the same numbers report the same basis, the same
 * holding period and the same XIRR.
 */
export function analyzeAdhocLots(input: AnalyzeAdhocLotsInput): PortfolioAnalysis {
  const lots = input.lots.map((lot) => toUnsavedLot(input.ticker, lot));
  return analyzePortfolio(lots, {
    ticker: input.ticker,
    currentMarketPrice: input.currentMarketPrice,
    trailingEPS: input.trailingEPS,
    today: input.today,
  });
}

/** What a save attempt did. Reported per-lot rather than as a single count so the
 *  screen can say "3 saved, 2 already recorded" instead of just "done". */
export interface SaveAdhocLotsResult {
  saved: TaxLot[];
  /** Lots that matched one already stored, and were therefore not inserted again. */
  skipped: AdhocLotInput[];
}

/**
 * True when a stored lot already records this transaction.
 *
 * Identity is `(buyDate, shares, pricePerShareCents)` — the three fields that make a
 * purchase the purchase it is. Brokerage and note are deliberately excluded: the
 * same buy re-seeded from the ledger can arrive with a note the stored copy lacks,
 * and treating that as a different lot would double the position, which is exactly
 * the failure this check exists to prevent. Price is compared in integer cents, so
 * there is no float-equality question.
 */
function isAlreadyStored(candidate: TaxLot, stored: TaxLot[]): boolean {
  return stored.some(
    (lot) =>
      lot.buyDate === candidate.buyDate &&
      lot.shares === candidate.shares &&
      lot.pricePerShareCents === candidate.pricePerShareCents,
  );
}

/**
 * Persists an ad-hoc set, skipping transactions already recorded for the ticker.
 *
 * The duplicate check is what makes this button safe to press twice — and pressing
 * it twice is the likely accident, since the set usually arrives seeded from the
 * ledger the lots were derived from. Candidates are checked against the growing
 * stored list, so two identical rows in ONE submission also collapse to one.
 */
export function saveAdhocLots(
  repo: TaxLotRepository,
  input: SaveAdhocLotsInput,
): SaveAdhocLotsResult {
  const stored = listTaxLots(repo, input.ticker);
  const result: SaveAdhocLotsResult = { saved: [], skipped: [] };

  for (const lot of input.lots) {
    const candidate = toUnsavedLot(input.ticker, lot);
    if (isAlreadyStored(candidate, stored)) {
      result.skipped.push(lot);
      continue;
    }
    const created = createTaxLot(repo, {
      ticker: input.ticker,
      buyDate: candidate.buyDate,
      shares: candidate.shares,
      pricePerShareCents: candidate.pricePerShareCents,
      isSplitAdjusted: candidate.isSplitAdjusted,
      brokerageFirm: candidate.brokerageFirm,
      note: candidate.note,
    });
    result.saved.push(created);
    // Appended so a repeated row inside this same submission is caught too.
    stored.push(created);
  }

  return result;
}
