import { type ColumnMapping, mapRow, parseCsv, parseNumeric, parseDateToIso, summarizeImportResults } from "@/lib/csv-import";
import type { ImportRowResult, ImportSummary } from "@/lib/csv-import";
import type { MarketDataClient } from "@/lib/market-data";
import type { StockPositionRepository } from "./ports";
import {
  createTransactionSchema,
  positionTypeSchema,
  updateTransactionSchema,
  upsertPositionSchema,
} from "./schema";
import type { CreateTransactionInput, UpdateTransactionInput, UpsertPositionInput } from "./schema";
import type { PortfolioSummary, StockPosition, StockTransaction, TransactionStats } from "./types";

export function listPositions(repo: StockPositionRepository): StockPosition[] {
  return repo.listPositions();
}

export function getPositionByTicker(
  repo: StockPositionRepository,
  ticker: string,
): StockPosition | undefined {
  return repo.getPositionByTicker(ticker);
}

export function upsertPosition(
  repo: StockPositionRepository,
  input: UpsertPositionInput,
): StockPosition {
  const validated = upsertPositionSchema.parse(input);
  const valueCents = Math.round(validated.currentPriceCents * validated.quantity);
  return repo.upsertPosition(validated, valueCents);
}

export function deletePosition(repo: StockPositionRepository, ticker: string): void {
  repo.deletePosition(ticker);
}

/** Pulls a live quote and updates one existing position's price/day-range/dividend fields. */
export async function refreshPosition(
  repo: StockPositionRepository,
  client: MarketDataClient,
  ticker: string,
): Promise<StockPosition> {
  const existing = repo.getPositionByTicker(ticker);
  if (!existing) throw new Error(`No position with ticker ${ticker}.`);

  const quote = await client.getQuote(ticker);
  const dayGainLossCents = Math.round((quote.priceCents - quote.previousCloseCents) * existing.quantity);

  return upsertPosition(repo, {
    ticker: existing.ticker,
    name: quote.shortName || existing.name,
    type: existing.type,
    currentPriceCents: quote.priceCents,
    quantity: existing.quantity,
    dayGainLossCents,
    dayHighCents: quote.dayHighCents,
    dayLowCents: quote.dayLowCents,
    dividendRateCents: quote.dividendRateCents,
  });
}

/**
 * Refreshes every position, tolerating individual failures (e.g. a delisted
 * ticker) so one bad quote doesn't block the rest — same behavior as the
 * source app's refresh-all loop.
 */
export async function refreshAllPositions(
  repo: StockPositionRepository,
  client: MarketDataClient,
): Promise<{ refreshed: StockPosition[]; failed: { ticker: string; error: string }[] }> {
  const refreshed: StockPosition[] = [];
  const failed: { ticker: string; error: string }[] = [];

  for (const position of repo.listPositions()) {
    try {
      refreshed.push(await refreshPosition(repo, client, position.ticker));
    } catch (error) {
      failed.push({ ticker: position.ticker, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { refreshed, failed };
}

export function listTransactions(
  repo: StockPositionRepository,
  ticker?: string,
): StockTransaction[] {
  return repo.listTransactions(ticker);
}

export function createTransaction(
  repo: StockPositionRepository,
  input: CreateTransactionInput,
): StockTransaction {
  const validated = createTransactionSchema.parse(input);
  const totalAmountCents = Math.round(validated.numberOfShares * validated.pricePerShareCents);
  return repo.createTransaction(validated, totalAmountCents);
}

export function updateTransaction(
  repo: StockPositionRepository,
  id: number,
  input: UpdateTransactionInput,
): StockTransaction {
  const validated = updateTransactionSchema.parse(input);
  const totalAmountCents = Math.round(validated.numberOfShares * validated.pricePerShareCents);
  return repo.updateTransaction(id, validated, totalAmountCents);
}

export function deleteTransaction(repo: StockPositionRepository, id: number): void {
  repo.deleteTransaction(id);
}

/** Totals value, day gain/loss, asset-class split, and annual dividend income across a set of positions. */
export function computePortfolioSummary(positions: StockPosition[]): PortfolioSummary {
  const summary = positions.reduce<PortfolioSummary>(
    (acc, position) => {
      const annualDividendCents = Math.round(position.dividendRateCents * position.quantity);
      return {
        positionCount: acc.positionCount + 1,
        totalValueCents: acc.totalValueCents + position.valueCents,
        totalDayGainLossCents: acc.totalDayGainLossCents + position.dayGainLossCents,
        dayChangePct: 0, // computed below, once totals are known
        stockValueCents: acc.stockValueCents + (position.type === "Stock" ? position.valueCents : 0),
        etfValueCents: acc.etfValueCents + (position.type === "ETF" ? position.valueCents : 0),
        otherValueCents:
          acc.otherValueCents +
          (position.type !== "Stock" && position.type !== "ETF" ? position.valueCents : 0),
        annualDividendIncomeCents: acc.annualDividendIncomeCents + annualDividendCents,
      };
    },
    {
      positionCount: 0,
      totalValueCents: 0,
      totalDayGainLossCents: 0,
      dayChangePct: 0,
      stockValueCents: 0,
      etfValueCents: 0,
      otherValueCents: 0,
      annualDividendIncomeCents: 0,
    },
  );

  const priorDayValueCents = summary.totalValueCents - summary.totalDayGainLossCents;
  summary.dayChangePct =
    priorDayValueCents === 0 ? 0 : (summary.totalDayGainLossCents / priorDayValueCents) * 100;

  return summary;
}

/** Count/avg/max/min price-per-share across a set of transactions (caller filters by ticker/date/action first). */
export function computeTransactionStats(transactions: StockTransaction[]): TransactionStats {
  if (transactions.length === 0) {
    return { count: 0, avgPricePerShareCents: 0, maxPricePerShareCents: 0, minPricePerShareCents: 0 };
  }

  const prices = transactions.map((transaction) => transaction.pricePerShareCents);
  return {
    count: transactions.length,
    avgPricePerShareCents: Math.round(prices.reduce((sum, price) => sum + price, 0) / prices.length),
    maxPricePerShareCents: Math.max(...prices),
    minPricePerShareCents: Math.min(...prices),
  };
}

/**
 * Share-weighted average buy price across a ticker's Buy transactions
 * (total cost / total shares bought). Undefined when there are no Buy
 * transactions — the caller decides the fallback (e.g. current price).
 */
export function computeAverageCostBasisCents(transactions: StockTransaction[]): number | undefined {
  const buys = transactions.filter((transaction) => transaction.action === "Buy");
  if (buys.length === 0) return undefined;

  const totalCostCents = buys.reduce(
    (sum, buy) => sum + buy.pricePerShareCents * buy.numberOfShares,
    0,
  );
  const totalShares = buys.reduce((sum, buy) => sum + buy.numberOfShares, 0);
  return totalShares > 0 ? totalCostCents / totalShares : undefined;
}

/**
 * Upserts positions from a CSV, one row per position. Blank/zero CSV values
 * preserve the existing position's field instead of clobbering it with a
 * default — brokerage exports rarely include every column this app tracks.
 */
export function importPositionsFromCsv(
  repo: StockPositionRepository,
  fileText: string,
  columnMapping: ColumnMapping,
): ImportSummary {
  const { rows } = parseCsv(fileText);
  const results: ImportRowResult[] = rows.map((row, index) => {
    const rowNumber = index + 1;
    const record = mapRow(row, columnMapping);
    const rawTicker = record.ticker?.trim();
    if (!rawTicker) return { rowNumber, status: "skipped", reason: "Missing ticker" };

    // Some brokerage exports append the company name, e.g. "AAPL - Apple Inc.".
    const ticker = rawTicker.split(" - ")[0].trim().toUpperCase();
    const existing = repo.getPositionByTicker(ticker);
    const parsedPrice = parseNumeric(record.currentPrice);
    const parsedQuantity = parseNumeric(record.quantity);
    const typeCandidate = positionTypeSchema.safeParse(record.type?.trim());

    try {
      upsertPosition(repo, {
        ticker,
        name: record.name?.trim() || existing?.name || "",
        type: typeCandidate.success ? typeCandidate.data : existing?.type ?? "Stock",
        currentPriceCents: parsedPrice > 0 ? Math.round(parsedPrice * 100) : existing?.currentPriceCents ?? 0,
        quantity: parsedQuantity > 0 ? parsedQuantity : existing?.quantity ?? 0,
        dayGainLossCents: existing?.dayGainLossCents ?? 0,
        dayHighCents: existing?.dayHighCents ?? 0,
        dayLowCents: existing?.dayLowCents ?? 0,
        dividendRateCents: existing?.dividendRateCents ?? 0,
      });
      return { rowNumber, status: "imported" };
    } catch (error) {
      return { rowNumber, status: "skipped", reason: error instanceof Error ? error.message : "Invalid row" };
    }
  });

  return summarizeImportResults(results);
}

/**
 * Inserts transactions from a CSV, skipping rows that duplicate an existing
 * transaction (same date/action/ticker/total) so re-importing the same
 * export is a safe no-op.
 */
export function importTransactionsFromCsv(
  repo: StockPositionRepository,
  fileText: string,
  columnMapping: ColumnMapping,
): ImportSummary {
  const { rows } = parseCsv(fileText);
  const results: ImportRowResult[] = rows.map((row, index) => {
    const rowNumber = index + 1;
    const record = mapRow(row, columnMapping);
    const rawTicker = record.ticker?.trim();
    if (!rawTicker) return { rowNumber, status: "skipped", reason: "Missing ticker" };

    const ticker = rawTicker.split(" - ")[0].trim().toUpperCase();
    const numberOfShares = parseNumeric(record.numberOfShares);
    const pricePerShareCents = Math.round(parseNumeric(record.pricePerShare) * 100);

    try {
      const validated = createTransactionSchema.parse({
        transactionAt: parseDateToIso(record.date),
        action: record.action?.trim() === "Sell" ? "Sell" : "Buy",
        ticker,
        numberOfShares,
        pricePerShareCents,
        note: record.note ?? "",
      });
      const totalAmountCents = Math.round(validated.numberOfShares * validated.pricePerShareCents);
      const { inserted } = repo.insertTransactionIfNotExists(validated, totalAmountCents);
      return inserted
        ? { rowNumber, status: "imported" }
        : { rowNumber, status: "skipped", reason: "Duplicate of an existing transaction" };
    } catch (error) {
      return { rowNumber, status: "skipped", reason: error instanceof Error ? error.message : "Invalid row" };
    }
  });

  return summarizeImportResults(results);
}
