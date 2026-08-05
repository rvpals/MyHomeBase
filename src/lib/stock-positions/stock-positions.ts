import {
  type ColumnMapping,
  constantValuesByField,
  mapRow,
  parseCsv,
  parseNumeric,
  parseDateToIso,
  parseDateWithFormat,
  selectImportRows,
  summarizeImportResults,
} from "@/lib/csv-import";
import type { FieldOptionsMap, ImportRowResult, ImportSummary } from "@/lib/csv-import";
import type { MarketDataClient } from "@/lib/market-data";
import type { StockPositionRepository, TransactionMatchKey } from "./ports";
import {
  createTransactionSchema,
  positionKeySchema,
  positionTypeSchema,
  updateTransactionSchema,
  upsertPositionSchema,
} from "./schema";
import type { CreateTransactionInput, UpdateTransactionInput, UpsertPositionInput } from "./schema";
import type {
  AllocationSlice,
  DayMove,
  DayMovesByType,
  MoverMeasure,
  PortfolioSummary,
  PositionKey,
  PositionType,
  StockPosition,
  StockTransaction,
  TickerDayMove,
  TransactionStats,
} from "./types";

/** Every position, or one account's when `accountId` is given (0 = Unassigned). */
export function listPositions(repo: StockPositionRepository, accountId?: number): StockPosition[] {
  return repo.listPositions(accountId);
}

export function getPosition(
  repo: StockPositionRepository,
  key: PositionKey,
): StockPosition | undefined {
  return repo.getPosition(positionKeySchema.parse(key));
}

/** Every account holding this ticker — a symbol can be held more than once. */
export function listPositionsByTicker(
  repo: StockPositionRepository,
  ticker: string,
): StockPosition[] {
  return repo.listPositionsByTicker(ticker);
}

export function upsertPosition(
  repo: StockPositionRepository,
  input: UpsertPositionInput,
): StockPosition {
  const validated = upsertPositionSchema.parse(input);
  const valueCents = Math.round(validated.currentPriceCents * validated.quantity);
  return repo.upsertPosition(validated, valueCents);
}

export function deletePosition(repo: StockPositionRepository, key: PositionKey): void {
  repo.deletePosition(positionKeySchema.parse(key));
}

/**
 * Pulls a live quote and updates one existing position's price/day-range/dividend
 * fields. Cost basis and the broker's classification are left alone — a quote
 * feed knows today's price, not what you paid.
 */
export async function refreshPosition(
  repo: StockPositionRepository,
  client: MarketDataClient,
  key: PositionKey,
): Promise<StockPosition> {
  const existing = repo.getPosition(positionKeySchema.parse(key));
  if (!existing)
    throw new Error(`No position with ticker ${key.ticker} in account ${key.accountId}.`);

  const quote = await client.getQuote(existing.ticker);
  const dayGainLossCents = Math.round(
    (quote.priceCents - quote.previousCloseCents) * existing.quantity,
  );
  const valueCents = Math.round(quote.priceCents * existing.quantity);

  return upsertPosition(repo, {
    ...existing,
    name: quote.shortName || existing.name,
    currentPriceCents: quote.priceCents,
    dayGainLossCents,
    dayHighCents: quote.dayHighCents,
    dayLowCents: quote.dayLowCents,
    dividendRateCents: quote.dividendRateCents,
    // A fresh price moves the unrealized gain, so recompute it against the stored
    // basis instead of leaving the broker's stale figure next to a new price.
    unrealizedGainLossCents: existing.costCents > 0 ? valueCents - existing.costCents : 0,
    unrealizedGainLossPct:
      existing.costCents > 0 ? ((valueCents - existing.costCents) / existing.costCents) * 100 : 0,
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
): Promise<{
  refreshed: StockPosition[];
  failed: { ticker: string; error: string }[];
}> {
  const refreshed: StockPosition[] = [];
  const failed: { ticker: string; error: string }[] = [];

  for (const position of repo.listPositions()) {
    try {
      refreshed.push(
        await refreshPosition(repo, client, {
          accountId: position.accountId,
          ticker: position.ticker,
        }),
      );
    } catch (error) {
      failed.push({
        ticker: position.ticker,
        error: error instanceof Error ? error.message : String(error),
      });
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

/**
 * Forward annual dividend for one holding. Prefers the broker's own figure when
 * the position carries one, because `dividendRateCents` is a per-share rate that
 * a quote feed often reports as 0 even for a payer.
 */
export function annualIncomeCents(position: StockPosition): number {
  return position.estAnnualIncomeCents > 0
    ? position.estAnnualIncomeCents
    : Math.round(position.dividendRateCents * position.quantity);
}

/**
 * Totals value, day gain/loss, asset-class split, cost basis and annual dividend
 * income across a set of positions. Cost-basis totals only count positions that
 * report a basis, so one unimported holding can't understate the whole return.
 */
export function computePortfolioSummary(positions: StockPosition[]): PortfolioSummary {
  const summary = positions.reduce<PortfolioSummary>(
    (acc, position) => ({
      positionCount: acc.positionCount + 1,
      totalValueCents: acc.totalValueCents + position.valueCents,
      totalDayGainLossCents: acc.totalDayGainLossCents + position.dayGainLossCents,
      dayChangePct: 0, // computed below, once totals are known
      stockValueCents: acc.stockValueCents + (position.type === "Stock" ? position.valueCents : 0),
      etfValueCents: acc.etfValueCents + (position.type === "ETF" ? position.valueCents : 0),
      otherValueCents:
        acc.otherValueCents +
        (position.type !== "Stock" && position.type !== "ETF" ? position.valueCents : 0),
      annualDividendIncomeCents: acc.annualDividendIncomeCents + annualIncomeCents(position),
      totalCostCents: acc.totalCostCents + position.costCents,
      // Only count the gain where there's a basis to measure it against, or the
      // percent below would divide a real gain by a partial cost.
      totalUnrealizedGainLossCents:
        acc.totalUnrealizedGainLossCents +
        (position.costCents > 0 ? position.unrealizedGainLossCents : 0),
      totalReturnPct: 0, // computed below
    }),
    {
      positionCount: 0,
      totalValueCents: 0,
      totalDayGainLossCents: 0,
      dayChangePct: 0,
      stockValueCents: 0,
      etfValueCents: 0,
      otherValueCents: 0,
      annualDividendIncomeCents: 0,
      totalCostCents: 0,
      totalUnrealizedGainLossCents: 0,
      totalReturnPct: 0,
    },
  );

  const priorDayValueCents = summary.totalValueCents - summary.totalDayGainLossCents;
  summary.dayChangePct =
    priorDayValueCents === 0 ? 0 : (summary.totalDayGainLossCents / priorDayValueCents) * 100;
  summary.totalReturnPct =
    summary.totalCostCents === 0
      ? 0
      : (summary.totalUnrealizedGainLossCents / summary.totalCostCents) * 100;

  return summary;
}

/**
 * A move as a percentage of what it was worth before moving. The denominator is
 * `value − gain`, not `value`: a +$5 day on a portfolio now worth $105 is +5%, not
 * +4.76%. Returns 0 rather than Infinity when there was nothing to move.
 */
export function changePct(valueCents: number, gainLossCents: number): number {
  const priorValueCents = valueCents - gainLossCents;
  return priorValueCents === 0 ? 0 : (gainLossCents / priorValueCents) * 100;
}

function toDayMove(valueCents: number, gainLossCents: number): DayMove {
  return {
    valueCents,
    gainLossCents,
    changePct: changePct(valueCents, gainLossCents),
  };
}

/**
 * Today's move split into Stock / ETF / Other, plus the total. "Other" carries
 * everything that isn't a stock or an ETF so the three parts always sum to the
 * whole — a portfolio with a money-market line would otherwise show a total that
 * didn't match its components.
 */
export function computeDayMovesByType(positions: StockPosition[]): DayMovesByType {
  const values = { stock: 0, etf: 0, other: 0 };
  const gains = { stock: 0, etf: 0, other: 0 };

  for (const position of positions) {
    const bucket = position.type === "Stock" ? "stock" : position.type === "ETF" ? "etf" : "other";
    values[bucket] += position.valueCents;
    gains[bucket] += position.dayGainLossCents;
  }

  return {
    stock: toDayMove(values.stock, gains.stock),
    etf: toDayMove(values.etf, gains.etf),
    other: toDayMove(values.other, gains.other),
    total: toDayMove(
      values.stock + values.etf + values.other,
      gains.stock + gains.etf + gains.other,
    ),
  };
}

/**
 * Today's move per ticker, summed across every account holding it — the question
 * "how did NVDA do today" is about the security, not about which account it sits
 * in. Stocks and ETFs are ranked together; the `type` is carried through so the
 * caller can label a row without re-joining to the positions.
 */
export function computeTickerDayMoves(positions: StockPosition[]): TickerDayMove[] {
  const byTicker = new Map<
    string,
    {
      name: string;
      type: PositionType;
      value: number;
      gain: number;
      shares: number;
      accounts: number;
    }
  >();

  for (const position of positions) {
    const existing = byTicker.get(position.ticker);
    if (existing) {
      existing.value += position.valueCents;
      existing.gain += position.dayGainLossCents;
      existing.shares += position.quantity;
      existing.accounts += 1;
      // Prefer a non-empty name: one account's import may have a name the other lacks.
      if (!existing.name) existing.name = position.name;
    } else {
      byTicker.set(position.ticker, {
        name: position.name,
        type: position.type,
        value: position.valueCents,
        gain: position.dayGainLossCents,
        shares: position.quantity,
        accounts: 1,
      });
    }
  }

  return [...byTicker.entries()].map(([ticker, entry]) => ({
    ticker,
    name: entry.name,
    type: entry.type,
    quantity: entry.shares,
    // Across accounts this is the share-weighted move, which for one security at
    // one price is just the price move. Rounded because it's money.
    perShareGainLossCents: entry.shares > 0 ? Math.round(entry.gain / entry.shares) : 0,
    accountCount: entry.accounts,
    ...toDayMove(entry.value, entry.gain),
  }));
}

/** The figure a mover list shows and sorts by. */
export function moverMeasureCents(move: TickerDayMove, measure: MoverMeasure): number {
  return measure === "total" ? move.gainLossCents : move.perShareGainLossCents;
}

/**
 * Sorts movers by the chosen measure, `direction` deciding which end leads, and
 * keeps only those actually moving that way.
 *
 * Filtering on the *measure* rather than on the total keeps the list honest under
 * either setting: a holding whose total moved but whose per-share figure rounds to
 * zero has no business in a per-share ranking.
 *
 * Ties break on percentage — scale-free, so it separates two tickers that made the
 * same dollars — and then on ticker, so the order is stable rather than depending
 * on which account was read first.
 */
function rankMovers(
  moves: TickerDayMove[],
  count: number,
  measure: MoverMeasure,
  direction: 1 | -1,
): TickerDayMove[] {
  return moves
    .filter((move) => moverMeasureCents(move, measure) * direction > 0)
    .sort(
      (a, b) =>
        (moverMeasureCents(b, measure) - moverMeasureCents(a, measure)) * direction ||
        (b.changePct - a.changePct) * direction ||
        a.ticker.localeCompare(b.ticker),
    )
    .slice(0, count);
}

/**
 * The `count` biggest risers today. Flat and falling tickers are excluded rather
 * than padding the list — "top gainers" with a loss in it is a lie, and a short
 * list is the honest answer on a red day.
 */
export function topGainers(
  moves: TickerDayMove[],
  count: number,
  measure: MoverMeasure = "total",
): TickerDayMove[] {
  return rankMovers(moves, count, measure, 1);
}

/** The `count` biggest fallers today, worst first. Risers and flats are excluded. */
export function topLosers(
  moves: TickerDayMove[],
  count: number,
  measure: MoverMeasure = "total",
): TickerDayMove[] {
  return rankMovers(moves, count, measure, -1);
}

/**
 * Rolls positions up by value into named slices, largest first. `label(position)`
 * picks the dimension — asset strategy, asset class, type, account — and anything
 * that resolves to a blank label is bucketed under `fallbackLabel` rather than
 * dropped, so the slices always sum to the whole portfolio.
 */
export function computeAllocation(
  positions: StockPosition[],
  label: (position: StockPosition) => string,
  fallbackLabel = "Unclassified",
): AllocationSlice[] {
  const totals = new Map<string, number>();
  for (const position of positions) {
    const key = label(position).trim() || fallbackLabel;
    totals.set(key, (totals.get(key) ?? 0) + position.valueCents);
  }

  const totalValueCents = [...totals.values()].reduce((sum, value) => sum + value, 0);
  return [...totals.entries()]
    .map(([sliceLabel, valueCents]) => ({
      label: sliceLabel,
      valueCents,
      sharePct: totalValueCents === 0 ? 0 : (valueCents / totalValueCents) * 100,
    }))
    .sort((a, b) => b.valueCents - a.valueCents);
}

/** Count/avg/max/min price-per-share across a set of transactions (caller filters by ticker/date/action first). */
export function computeTransactionStats(transactions: StockTransaction[]): TransactionStats {
  if (transactions.length === 0) {
    return {
      count: 0,
      avgPricePerShareCents: 0,
      maxPricePerShareCents: 0,
      minPricePerShareCents: 0,
    };
  }

  const prices = transactions.map((transaction) => transaction.pricePerShareCents);
  return {
    count: transactions.length,
    avgPricePerShareCents: Math.round(
      prices.reduce((sum, price) => sum + price, 0) / prices.length,
    ),
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

/** The fields a Positions CSV column can be mapped to, in the order the UI lists them. */
export const POSITION_IMPORT_FIELDS: readonly {
  value: string;
  label: string;
}[] = [
  { value: "ticker", label: "Ticker" },
  { value: "name", label: "Name" },
  { value: "type", label: "Type (Stock/ETF/…)" },
  { value: "quantity", label: "Quantity (shares)" },
  { value: "currentPrice", label: "Current price / share" },
  { value: "dayGainLoss", label: "Day gain/loss ($ total)" },
  { value: "cost", label: "Cost basis ($ total)" },
  { value: "unitCost", label: "Unit cost / share" },
  { value: "unrealizedGainLoss", label: "Unrealized gain/loss ($)" },
  { value: "unrealizedGainLossPct", label: "Unrealized gain/loss (%)" },
  { value: "estAnnualIncome", label: "Est. annual income ($)" },
  { value: "incomeEarned", label: "Income earned to date ($)" },
  { value: "cusip", label: "CUSIP" },
  { value: "isin", label: "ISIN" },
  { value: "assetClass", label: "Asset class" },
  { value: "assetStrategy", label: "Asset strategy" },
];

/**
 * Maps a broker's asset-class text onto this app's instrument `type`. Only used
 * when the CSV has no column that already says "ETF"/"Stock" outright, which is
 * the common case — brokers report a *class* ("Equity") not an instrument kind.
 * An unrecognized class yields undefined so the caller can keep what it had.
 */
export function inferPositionType(
  assetClass: string,
  assetStrategy: string,
): "Stock" | "ETF" | "Bond" | "MutualFund" | "Other" | undefined {
  const text = `${assetClass} ${assetStrategy}`.toLowerCase();
  if (text.includes("money market") || text.includes("cash")) return "Other";
  if (text.includes("etf") || text.includes("exchange traded")) return "ETF";
  if (text.includes("mutual fund")) return "MutualFund";
  if (text.includes("fixed income") || text.includes("bond")) return "Bond";
  if (text.includes("equity")) return "Stock";
  return undefined;
}

/**
 * The instrument type a mapped CSV row resolves to, in precedence order: an
 * explicit, valid Type value wins; otherwise the broker's asset class/strategy is
 * interpreted; otherwise `fallback`.
 *
 * Shared by the importer and the import screen's per-row Type dropdown so the
 * dropdown shows what will actually be stored. Duplicating this in the view was the
 * alternative, and it would have drifted the first time the rules changed.
 */
export function resolvePositionType(
  record: { type?: string; assetClass?: string; assetStrategy?: string },
  fallback: PositionType = "Stock",
): PositionType {
  const explicit = positionTypeSchema.safeParse(record.type?.trim());
  if (explicit.success) return explicit.data;
  return inferPositionType(record.assetClass ?? "", record.assetStrategy ?? "") ?? fallback;
}

/** Cents from a dollar cell, rounded. Blank/unparseable reads as 0. */
function dollarsToCents(value: string | undefined): number {
  return Math.round(parseNumeric(value) * 100);
}

/**
 * Everything optional about a positions import.
 *
 * An options object rather than a seventh positional parameter — a call reading
 * `importPositionsFromCsv(repo, csv, mapping, 0, {}, [1], {})` told the reader
 * nothing about which argument was which.
 */
export interface PositionImportOptions {
  /** Which account the rows land in. 0 = Unassigned. */
  accountId?: number;
  /** Per-column interpretation: date formats, and column-wide fixed values. */
  fieldOptions?: FieldOptionsMap;
  /** 0-based indexes of rows the user removed from the grid before importing. */
  excludedRowIndexes?: readonly number[];
  /**
   * Per-row values set by hand — `rowIndex -> field -> value`. Beats both the cell
   * and any column-wide fixed value, being the most specific thing the user said.
   * This is how a file mixing ETFs and stocks gets each row's Type set one by one.
   */
  rowValueOverrides?: Record<number, Record<string, string>>;
}

/**
 * Upserts positions from a CSV, one row per position, into `options.accountId`
 * (0 = Unassigned). Blank/zero CSV values preserve the existing position's field
 * instead of clobbering it with a default — brokerage exports rarely include
 * every column this app tracks.
 */
export function importPositionsFromCsv(
  repo: StockPositionRepository,
  fileText: string,
  columnMapping: ColumnMapping,
  options: PositionImportOptions = {},
): ImportSummary {
  const {
    accountId = 0,
    fieldOptions = {},
    excludedRowIndexes = [],
    rowValueOverrides = {},
  } = options;

  const { rows } = parseCsv(fileText);
  // Fixed values override whatever the mapped cell said, so they're spread last.
  const constants = constantValuesByField(columnMapping, fieldOptions);

  const results: ImportRowResult[] = selectImportRows(rows, excludedRowIndexes).map(
    ({ row, rowIndex, rowNumber }) => {
      // Precedence, least to most specific: the cell, then a column-wide fixed
      // value, then this row's own override.
      const record = {
        ...mapRow(row, columnMapping),
        ...constants,
        ...(rowValueOverrides[rowIndex] ?? {}),
      };
      const rawTicker = record.ticker?.trim();
      if (!rawTicker) return { rowNumber, status: "skipped", reason: "Missing ticker" };

      // Some brokerage exports append the company name, e.g. "AAPL - Apple Inc.".
      const ticker = rawTicker.split(" - ")[0].trim().toUpperCase();
      const existing = repo.getPosition({ accountId, ticker });
      const parsedPrice = parseNumeric(record.currentPrice);
      const parsedQuantity = parseNumeric(record.quantity);
      const assetClass = record.assetClass?.trim() ?? "";
      const assetStrategy = record.assetStrategy?.trim() ?? "";

      // An explicit Type value wins; otherwise the broker's asset class is
      // interpreted, then whatever the position already said.
      const type = resolvePositionType(
        { type: record.type, assetClass, assetStrategy },
        existing?.type ?? "Stock",
      );

      const costCents =
        record.cost === undefined ? (existing?.costCents ?? 0) : dollarsToCents(record.cost);
      const valueCents = Math.round((parsedPrice > 0 ? parsedPrice : 0) * parsedQuantity * 100);

      try {
        upsertPosition(repo, {
          accountId,
          ticker,
          name: record.name?.trim() || existing?.name || "",
          type,
          currentPriceCents:
            parsedPrice > 0 ? Math.round(parsedPrice * 100) : (existing?.currentPriceCents ?? 0),
          quantity: parsedQuantity > 0 ? parsedQuantity : (existing?.quantity ?? 0),
          dayGainLossCents:
            record.dayGainLoss === undefined
              ? (existing?.dayGainLossCents ?? 0)
              : dollarsToCents(record.dayGainLoss),
          dayHighCents: existing?.dayHighCents ?? 0,
          dayLowCents: existing?.dayLowCents ?? 0,
          dividendRateCents: existing?.dividendRateCents ?? 0,
          costCents,
          // Unit cost is redundant with cost/quantity, so derive it when the export
          // gives a total but no per-share figure.
          unitCostCents:
            record.unitCost !== undefined
              ? dollarsToCents(record.unitCost)
              : costCents > 0 && parsedQuantity > 0
                ? Math.round(costCents / parsedQuantity)
                : (existing?.unitCostCents ?? 0),
          unrealizedGainLossCents:
            record.unrealizedGainLoss !== undefined
              ? dollarsToCents(record.unrealizedGainLoss)
              : costCents > 0 && valueCents > 0
                ? valueCents - costCents
                : (existing?.unrealizedGainLossCents ?? 0),
          unrealizedGainLossPct:
            record.unrealizedGainLossPct !== undefined
              ? parseNumeric(record.unrealizedGainLossPct)
              : (existing?.unrealizedGainLossPct ?? 0),
          cusip: record.cusip?.trim() || existing?.cusip || "",
          isin: record.isin?.trim() || existing?.isin || "",
          assetClass: assetClass || existing?.assetClass || "",
          assetStrategy: assetStrategy || existing?.assetStrategy || "",
          estAnnualIncomeCents:
            record.estAnnualIncome === undefined
              ? (existing?.estAnnualIncomeCents ?? 0)
              : dollarsToCents(record.estAnnualIncome),
          incomeEarnedCents:
            record.incomeEarned === undefined
              ? (existing?.incomeEarnedCents ?? 0)
              : dollarsToCents(record.incomeEarned),
        });
        return { rowNumber, status: "imported" };
      } catch (error) {
        return {
          rowNumber,
          status: "skipped",
          reason: error instanceof Error ? error.message : "Invalid row",
        };
      }
    },
  );

  return summarizeImportResults(results);
}

/** The fields a Transactions CSV column can be mapped to. */
export const TRANSACTION_IMPORT_FIELDS: readonly {
  value: string;
  label: string;
}[] = [
  { value: "date", label: "Date" },
  { value: "action", label: "Action (Buy/Sell)" },
  { value: "ticker", label: "Ticker" },
  { value: "numberOfShares", label: "Shares" },
  { value: "pricePerShare", label: "Price / share" },
  { value: "totalAmount", label: "Total amount ($)" },
  { value: "brokerageFirm", label: "Brokerage firm" },
  { value: "externalId", label: "Broker reference / confirmation #" },
  { value: "note", label: "Note" },
];

/**
 * The fields that make two transactions the same trade when no broker reference is
 * available. Note and external id are excluded: a differing note doesn't make it a
 * different trade.
 */
function matchKeyFor(input: CreateTransactionInput): TransactionMatchKey {
  return {
    transactionAt: input.transactionAt,
    action: input.action,
    ticker: input.ticker,
    numberOfShares: input.numberOfShares,
    pricePerShareCents: input.pricePerShareCents,
    brokerageFirm: input.brokerageFirm,
  };
}

/** The source date format the user set for the mapped date column, if any. */
function mappedDateFormat(
  columnMapping: ColumnMapping,
  fieldOptions: FieldOptionsMap,
): string | undefined {
  const dateColumn = Object.entries(columnMapping).find(([, field]) => field === "date")?.[0];
  const format = dateColumn === undefined ? undefined : fieldOptions[dateColumn]?.dateFormat;
  return format?.trim() ? format.trim() : undefined;
}

/**
 * Inserts transactions from a CSV, skipping rows that duplicate an existing
 * transaction (same date/action/ticker/total) so re-importing the same
 * export is a safe no-op.
 *
 * When `fieldOptions` gives the date column a format, dates are read strictly by
 * it — the right call for an ambiguous export like "03/04/2026", where guessing
 * silently picks a month. Without a format, dates are parsed loosely as before.
 *
 * Either `pricePerShare` or `totalAmount` will do: given only a total, the
 * per-share price is derived from it. The stored total is always recomputed from
 * shares × price so it can never contradict its own parts — which means a fractional
 * holding can land a cent away from the total the file stated.
 */
export function importTransactionsFromCsv(
  repo: StockPositionRepository,
  fileText: string,
  columnMapping: ColumnMapping,
  fieldOptions: FieldOptionsMap = {},
  excludedRowIndexes: readonly number[] = [],
): ImportSummary {
  const { rows } = parseCsv(fileText);
  const dateFormat = mappedDateFormat(columnMapping, fieldOptions);
  const constants = constantValuesByField(columnMapping, fieldOptions);

  // How many copies of each trade this file has produced so far, and how many the
  // table held before the import began. `storedByKey` is read once per distinct trade
  // and then reused — rows this run inserts must not inflate the stored baseline, or
  // the second identical lot in a file would look like a duplicate of the first.
  const seenByKey = new Map<string, number>();
  const storedByKey = new Map<string, number>();

  const results: ImportRowResult[] = selectImportRows(rows, excludedRowIndexes).map(
    ({ row, rowNumber }) => {
      const record = { ...mapRow(row, columnMapping), ...constants };
      const rawTicker = record.ticker?.trim();
      if (!rawTicker) return { rowNumber, status: "skipped", reason: "Missing ticker" };

      const ticker = rawTicker.split(" - ")[0].trim().toUpperCase();
      const numberOfShares = parseNumeric(record.numberOfShares);

      // Plenty of exports give a row's total but no per-share price. Back the price
      // out of the total rather than importing a zero, so a file with only Shares +
      // Total is usable. An explicit price/share always wins — it's the figure the
      // broker actually printed, and the stored total stays derived from it, which is
      // what keeps `total = shares × price` true for every row.
      const mappedPriceCents = Math.round(parseNumeric(record.pricePerShare) * 100);
      const totalFromFileCents = Math.round(parseNumeric(record.totalAmount) * 100);
      const pricePerShareCents =
        mappedPriceCents > 0
          ? mappedPriceCents
          : totalFromFileCents > 0 && numberOfShares > 0
            ? Math.round(totalFromFileCents / numberOfShares)
            : 0;

      try {
        const validated = createTransactionSchema.parse({
          transactionAt:
            dateFormat === undefined
              ? parseDateToIso(record.date)
              : parseDateWithFormat(record.date ?? "", dateFormat),
          action: record.action?.trim() === "Sell" ? "Sell" : "Buy",
          ticker,
          numberOfShares,
          pricePerShareCents,
          brokerageFirm: record.brokerageFirm ?? "",
          externalId: record.externalId ?? "",
          note: record.note ?? "",
        });

        // With a broker reference, identity is exact and one lookup settles it.
        if (validated.externalId !== "") {
          if (repo.hasTransactionWithExternalId(validated.externalId)) {
            return {
              rowNumber,
              status: "skipped",
              reason: `Already imported (reference ${validated.externalId})`,
            };
          }
        } else {
          // Without one, identity is a count, not a yes/no. `transaction_at` is a
          // date, so several identical lots in one day are several real trades. Insert
          // this row only if the file's copies so far outnumber what's already stored;
          // re-importing the same file therefore inserts nothing.
          const key = matchKeyFor(validated);
          const keyText = JSON.stringify(key);
          const seenInFile = (seenByKey.get(keyText) ?? 0) + 1;
          seenByKey.set(keyText, seenInFile);

          let storedCount = storedByKey.get(keyText);
          if (storedCount === undefined) {
            storedCount = repo.countMatchingTransactions(key);
            storedByKey.set(keyText, storedCount);
          }

          if (seenInFile <= storedCount) {
            return {
              rowNumber,
              status: "skipped",
              reason: "Duplicate of an existing transaction",
            };
          }
        }

        const totalAmountCents = Math.round(
          validated.numberOfShares * validated.pricePerShareCents,
        );
        repo.createTransaction(validated, totalAmountCents);
        return { rowNumber, status: "imported" };
      } catch (error) {
        return {
          rowNumber,
          status: "skipped",
          reason: error instanceof Error ? error.message : "Invalid row",
        };
      }
    },
  );

  return summarizeImportResults(results);
}
