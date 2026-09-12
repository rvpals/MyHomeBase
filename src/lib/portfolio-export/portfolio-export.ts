/**
 * Turning stored positions into the payload an AI is asked to analyse.
 *
 * Pure: every function here takes data and returns data. The caller reads the
 * positions, accounts and sector map (the web action and the CLI both do) and
 * hands them in, so the same export can be produced in a test with no database.
 */

import { centsToDollars } from "@/lib/shared/money";
import type { StockPosition } from "@/lib/stock-positions";
import { exclusionReason, inferAccountKind, sanitizeAccountLabel } from "./account-kind";
import type {
  AccountKind,
  AccountKindWeight,
  AnalysisFocus,
  ExcludedAccount,
  ExportHolding,
  ExportSummary,
  PortfolioExportPayload,
  SectorWeight,
} from "./types";
import { DEFAULT_EXPORTED_KINDS } from "./types";

/** The minimum an account has to look like for the export to classify it. */
export interface ExportAccountInput {
  id: number;
  name: string;
}

export interface BuildExportInput {
  positions: StockPosition[];
  accounts: ExportAccountInput[];
  /** Ticker (upper-case) to its resolved sector label. Missing means unclassified. */
  sectorsByTicker: Map<string, string>;
  asOf: string;
  focus: AnalysisFocus[];
  /** Which account kinds to include. Defaults to taxable + IRAs. */
  includeKinds?: readonly AccountKind[];
}

/**
 * Positions whose ticker names a cash or money-market holding.
 *
 * Matched on the symbol rather than the type because brokers file a sweep fund
 * as an ordinary position — `SPAXX` arrives typed "Other" or even "MutualFund",
 * never as anything that says "this is cash". The cash allocation is one of the
 * summary figures the analysis leans on, so getting it from the symbol is worth
 * more than trusting a type the importer never sets.
 */
const CASH_TICKERS = new Set(["SPAXX", "FDRXX", "FZFXX", "SPRXX", "VMFXX", "CASH", "USD", "FCASH"]);

function isCashHolding(ticker: string, vehicle: string): boolean {
  return CASH_TICKERS.has(ticker.toUpperCase()) || vehicle.toLowerCase() === "cash";
}

/** Rounds to `places` decimals, avoiding the float dust that shows up in JSON. */
function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * Which accounts are exported, with an anonymous label for each, plus the ones
 * left out and why.
 *
 * Labels are assigned over accounts sorted by id so the numbering is stable
 * between two exports of the same data.
 */
export function classifyAccounts(
  accounts: ExportAccountInput[],
  includeKinds: readonly AccountKind[] = DEFAULT_EXPORTED_KINDS,
): {
  includedByAccountId: Map<number, { kind: AccountKind; label: string }>;
  excluded: ExcludedAccount[];
} {
  const included = new Set(includeKinds);
  const sorted = [...accounts].sort((a, b) => a.id - b.id);

  const kindOf = new Map<number, AccountKind>();
  const countByKind = new Map<AccountKind, number>();
  for (const account of sorted) {
    const kind = inferAccountKind(account.name);
    kindOf.set(account.id, kind);
    if (included.has(kind)) countByKind.set(kind, (countByKind.get(kind) ?? 0) + 1);
  }

  const includedByAccountId = new Map<number, { kind: AccountKind; label: string }>();
  const excluded: ExcludedAccount[] = [];
  const seenByKind = new Map<AccountKind, number>();

  for (const account of sorted) {
    const kind = kindOf.get(account.id)!;
    if (!included.has(kind)) {
      // The excluded list is itself anonymised: it exists to tell the model that
      // money it cannot see is deliberately absent, not to name the institution.
      excluded.push({ label: kind, kind, reason: exclusionReason(kind) });
      continue;
    }
    const ordinal = (seenByKind.get(kind) ?? 0) + 1;
    seenByKind.set(kind, ordinal);
    includedByAccountId.set(account.id, {
      kind,
      label: sanitizeAccountLabel(kind, ordinal, countByKind.get(kind) ?? 1),
    });
  }

  return { includedByAccountId, excluded };
}

/**
 * One row per ticker, summed across every exported account holding it.
 *
 * Cost basis is summed in cents and divided at the end, so a ticker held in two
 * accounts at different prices reports the true blended average rather than the
 * mean of two averages. A position reporting no basis (`costCents === 0`)
 * contributes its value but not a basis, and the result says so with `null`
 * rather than implying a free position.
 */
export function aggregateHoldings(
  positions: StockPosition[],
  includedByAccountId: Map<number, { kind: AccountKind; label: string }>,
  sectorsByTicker: Map<string, string>,
): ExportHolding[] {
  interface Accumulator {
    ticker: string;
    name: string;
    vehicle: string;
    kinds: Set<AccountKind>;
    quantity: number;
    valueCents: number;
    costCents: number;
    /** Only the shares that came with a basis, so the average is honest. */
    quantityWithCost: number;
    lastPriceCents: number;
  }

  const byTicker = new Map<string, Accumulator>();

  for (const position of positions) {
    const account = includedByAccountId.get(position.accountId);
    if (!account) continue;

    const key = position.ticker.toUpperCase();
    let entry = byTicker.get(key);
    if (!entry) {
      entry = {
        ticker: key,
        name: position.name.trim() || key,
        vehicle: position.type,
        kinds: new Set<AccountKind>(),
        quantity: 0,
        valueCents: 0,
        costCents: 0,
        quantityWithCost: 0,
        lastPriceCents: 0,
      };
      byTicker.set(key, entry);
    }

    entry.kinds.add(account.kind);
    entry.quantity += position.quantity;
    entry.valueCents += position.valueCents;
    if (position.costCents > 0) {
      entry.costCents += position.costCents;
      entry.quantityWithCost += position.quantity;
    }
    // Price is per-share and identical across accounts; keep the last non-zero
    // one rather than summing, which would multiply the price by the account count.
    if (position.currentPriceCents > 0) entry.lastPriceCents = position.currentPriceCents;
    // A blank name in one account should not beat a real one in another.
    if (!entry.name && position.name.trim()) entry.name = position.name.trim();
  }

  const totalValueCents = [...byTicker.values()].reduce((sum, entry) => sum + entry.valueCents, 0);

  return [...byTicker.values()]
    .map((entry) => {
      const hasBasis = entry.costCents > 0 && entry.quantityWithCost > 0;
      const marketValue = centsToDollars(entry.valueCents);
      const gainLossCents = hasBasis ? entry.valueCents - entry.costCents : 0;

      return {
        ticker: entry.ticker,
        name: entry.name,
        vehicle: entry.vehicle,
        // Sorted so the JSON is byte-stable for the same holdings.
        accounts: [...entry.kinds].sort(),
        quantity: round(entry.quantity, 4),
        averageCostBasis: hasBasis
          ? round(centsToDollars(entry.costCents) / entry.quantityWithCost, 4)
          : null,
        currentPrice: round(centsToDollars(entry.lastPriceCents), 2),
        marketValue: round(marketValue, 2),
        unrealizedGainLoss: hasBasis ? round(centsToDollars(gainLossCents), 2) : null,
        unrealizedGainLossPct: hasBasis
          ? round((gainLossCents / entry.costCents) * 100, 2)
          : null,
        weightPct: totalValueCents === 0 ? 0 : round((entry.valueCents / totalValueCents) * 100, 2),
        sector: sectorsByTicker.get(entry.ticker) ?? "Unclassified",
        expenseRatio: null,
      } satisfies ExportHolding;
    })
    .sort((a, b) => b.marketValue - a.marketValue);
}

/** The headline figures, computed from the aggregated holdings. */
export function summarize(
  holdings: ExportHolding[],
  includedByAccountId: Map<number, { kind: AccountKind; label: string }>,
  positions: StockPosition[],
): ExportSummary {
  const totalMarketValue = holdings.reduce((sum, holding) => sum + holding.marketValue, 0);

  // Only holdings that report a basis contribute to either side of the return,
  // so the percentage compares like with like.
  const withBasis = holdings.filter((holding) => holding.unrealizedGainLoss !== null);
  const totalUnrealizedGainLoss = withBasis.reduce(
    (sum, holding) => sum + (holding.unrealizedGainLoss ?? 0),
    0,
  );
  const totalCostBasis = withBasis.reduce(
    (sum, holding) => sum + (holding.marketValue - (holding.unrealizedGainLoss ?? 0)),
    0,
  );

  const cashValue = holdings
    .filter((holding) => isCashHolding(holding.ticker, holding.vehicle))
    .reduce((sum, holding) => sum + holding.marketValue, 0);

  const sectorTotals = new Map<string, number>();
  for (const holding of holdings) {
    sectorTotals.set(holding.sector, (sectorTotals.get(holding.sector) ?? 0) + holding.marketValue);
  }
  const topSectors: SectorWeight[] = [...sectorTotals.entries()]
    .map(([sector, marketValue]) => ({
      sector,
      marketValue: round(marketValue, 2),
      weightPct: totalMarketValue === 0 ? 0 : round((marketValue / totalMarketValue) * 100, 2),
    }))
    .sort((a, b) => b.marketValue - a.marketValue)
    .slice(0, 3);

  // Per-kind totals come from the raw positions: a ticker held in two kinds of
  // account splits between them, which an aggregated holding can no longer show.
  const kindTotals = new Map<AccountKind, { value: number; tickers: Set<string> }>();
  for (const position of positions) {
    const account = includedByAccountId.get(position.accountId);
    if (!account) continue;
    let entry = kindTotals.get(account.kind);
    if (!entry) {
      entry = { value: 0, tickers: new Set<string>() };
      kindTotals.set(account.kind, entry);
    }
    entry.value += centsToDollars(position.valueCents);
    entry.tickers.add(position.ticker.toUpperCase());
  }
  const byAccountKind: AccountKindWeight[] = [...kindTotals.entries()]
    .map(([kind, entry]) => ({
      kind,
      marketValue: round(entry.value, 2),
      weightPct: totalMarketValue === 0 ? 0 : round((entry.value / totalMarketValue) * 100, 2),
      holdingCount: entry.tickers.size,
    }))
    .sort((a, b) => b.marketValue - a.marketValue);

  return {
    totalMarketValue: round(totalMarketValue, 2),
    totalCostBasis: round(totalCostBasis, 2),
    totalUnrealizedGainLoss: round(totalUnrealizedGainLoss, 2),
    totalUnrealizedGainLossPct:
      totalCostBasis === 0 ? 0 : round((totalUnrealizedGainLoss / totalCostBasis) * 100, 2),
    holdingCount: holdings.length,
    accountCount: includedByAccountId.size,
    cashAllocationPct: totalMarketValue === 0 ? 0 : round((cashValue / totalMarketValue) * 100, 2),
    topSectors,
    byAccountKind,
    unclassifiedHoldingCount: holdings.filter(
      (holding) => holding.sector === "Unclassified" || holding.sector === "ETFs & funds",
    ).length,
    missingCostBasisCount: holdings.filter((holding) => holding.averageCostBasis === null).length,
  };
}

/** The whole payload: classify, aggregate, summarise. */
export function buildPortfolioExport(input: BuildExportInput): PortfolioExportPayload {
  const { includedByAccountId, excluded } = classifyAccounts(input.accounts, input.includeKinds);
  const holdings = aggregateHoldings(input.positions, includedByAccountId, input.sectorsByTicker);
  const summary = summarize(holdings, includedByAccountId, input.positions);

  return {
    asOf: input.asOf,
    summary,
    holdings,
    excludedAccounts: excluded,
    focus: input.focus,
  };
}
