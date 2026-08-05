"use server";

import { revalidatePath } from "next/cache";
import { lookupQuote } from "@/lib/market-data";
import {
  createTransaction,
  deletePosition,
  deleteTransaction,
  listPositions,
  refreshAllPositions,
  refreshPosition,
  updateTransaction,
  upsertPosition,
} from "@/lib/stock-positions";
import type { PositionType, TransactionAction } from "@/lib/stock-positions";
import { centsToDollars, dollarsToCents } from "@/lib/shared/money";
import { deps } from "@/lib/wiring";

const STOCK_ETFS_MODULE_PATH = "/modules/stock-etfs";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** Every numeric field is the raw string from its input; the action parses them. */
export interface PositionFormInput {
  /** 0 = Unassigned. */
  accountId: number;
  ticker: string;
  name: string;
  type: PositionType;
  currentPrice: string;
  quantity: string;
  dayGainLoss: string;
  dayHigh: string;
  dayLow: string;
  dividendRate: string;
  cost: string;
  unitCost: string;
  unrealizedGainLoss: string;
  unrealizedGainLossPct: string;
  estAnnualIncome: string;
  incomeEarned: string;
  cusip: string;
  isin: string;
  assetClass: string;
  assetStrategy: string;
}

export interface TransactionFormInput {
  transactionAt: string;
  action: TransactionAction;
  ticker: string;
  numberOfShares: string;
  pricePerShare: string;
  brokerageFirm?: string;
  /** The broker's reference number, when you have one. Blank is fine. */
  externalId?: string;
  note?: string;
}

function toErrorResult(error: unknown, fallback: string): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

export async function upsertPositionAction(input: PositionFormInput): Promise<ActionResult> {
  try {
    upsertPosition(deps.stockPositionRepo, {
      accountId: input.accountId,
      ticker: input.ticker,
      name: input.name,
      type: input.type,
      currentPriceCents: dollarsToCents(input.currentPrice || "0"),
      quantity: Number(input.quantity || "0"),
      dayGainLossCents: dollarsToCents(input.dayGainLoss || "0"),
      dayHighCents: dollarsToCents(input.dayHigh || "0"),
      dayLowCents: dollarsToCents(input.dayLow || "0"),
      dividendRateCents: dollarsToCents(input.dividendRate || "0"),
      costCents: dollarsToCents(input.cost || "0"),
      unitCostCents: dollarsToCents(input.unitCost || "0"),
      unrealizedGainLossCents: dollarsToCents(input.unrealizedGainLoss || "0"),
      unrealizedGainLossPct: Number(input.unrealizedGainLossPct || "0"),
      estAnnualIncomeCents: dollarsToCents(input.estAnnualIncome || "0"),
      incomeEarnedCents: dollarsToCents(input.incomeEarned || "0"),
      cusip: input.cusip,
      isin: input.isin,
      assetClass: input.assetClass,
      assetStrategy: input.assetStrategy,
    });
  } catch (error) {
    return toErrorResult(error, "Failed to save position.");
  }
  revalidatePath(STOCK_ETFS_MODULE_PATH);
  return { ok: true };
}

export async function deletePositionAction(accountId: number, ticker: string): Promise<ActionResult> {
  try {
    deletePosition(deps.stockPositionRepo, { accountId, ticker });
  } catch (error) {
    return toErrorResult(error, "Failed to delete position.");
  }
  revalidatePath(STOCK_ETFS_MODULE_PATH);
  return { ok: true };
}

export async function createTransactionAction(input: TransactionFormInput): Promise<ActionResult> {
  try {
    createTransaction(deps.stockPositionRepo, {
      transactionAt: input.transactionAt,
      action: input.action,
      ticker: input.ticker,
      numberOfShares: Number(input.numberOfShares || "0"),
      pricePerShareCents: dollarsToCents(input.pricePerShare || "0"),
      brokerageFirm: input.brokerageFirm ?? "",
      externalId: input.externalId ?? "",
      note: input.note ?? "",
    });
  } catch (error) {
    return toErrorResult(error, "Failed to record transaction.");
  }
  revalidatePath(STOCK_ETFS_MODULE_PATH);
  return { ok: true };
}

export async function updateTransactionAction(
  transactionId: number,
  input: TransactionFormInput,
): Promise<ActionResult> {
  try {
    updateTransaction(deps.stockPositionRepo, transactionId, {
      transactionAt: input.transactionAt,
      action: input.action,
      ticker: input.ticker,
      numberOfShares: Number(input.numberOfShares || "0"),
      pricePerShareCents: dollarsToCents(input.pricePerShare || "0"),
      brokerageFirm: input.brokerageFirm ?? "",
      externalId: input.externalId ?? "",
      note: input.note ?? "",
    });
  } catch (error) {
    return toErrorResult(error, "Failed to update transaction.");
  }
  revalidatePath(STOCK_ETFS_MODULE_PATH);
  return { ok: true };
}

export interface QuoteResult {
  ok: boolean;
  name?: string;
  currentPrice?: string;
  dayHigh?: string;
  dayLow?: string;
  dividendRate?: string;
  error?: string;
}

export async function fetchQuoteAction(ticker: string): Promise<QuoteResult> {
  try {
    const quote = await lookupQuote(deps.marketDataClient, ticker);
    return {
      ok: true,
      name: quote.shortName,
      currentPrice: centsToDollars(quote.priceCents).toFixed(2),
      dayHigh: centsToDollars(quote.dayHighCents).toFixed(2),
      dayLow: centsToDollars(quote.dayLowCents).toFixed(2),
      dividendRate: centsToDollars(quote.dividendRateCents).toFixed(2),
    };
  } catch (error) {
    return toErrorResult(error, "Failed to fetch a live quote.");
  }
}

export interface RefreshAllResult extends ActionResult {
  refreshedCount?: number;
  failed?: { ticker: string; error: string }[];
}

export interface RefreshTarget {
  accountId: number;
  ticker: string;
  name: string;
}

/**
 * The positions a progressive refresh will walk, in order. The dashboard reads
 * this first so it can show "3 of 34" and name each ticker before fetching it —
 * a single all-in-one action can't report progress, because a server action
 * returns once.
 */
export async function listRefreshTargetsAction(): Promise<RefreshTarget[]> {
  return listPositions(deps.stockPositionRepo).map((position) => ({
    accountId: position.accountId,
    ticker: position.ticker,
    name: position.name,
  }));
}

export interface RefreshOneResult extends ActionResult {
  ticker: string;
  /** Formatted price, e.g. "220.15". Absent when the fetch failed. */
  price?: string;
  name?: string;
}

/**
 * Refreshes one position. Never throws: a delisted or renamed ticker comes back as
 * `ok: false` so the caller's loop can note it and carry on, the same tolerance
 * `refreshAllPositions` applies internally.
 */
export async function refreshOnePositionAction(
  accountId: number,
  ticker: string,
): Promise<RefreshOneResult> {
  try {
    const position = await refreshPosition(deps.stockPositionRepo, deps.marketDataClient, {
      accountId,
      ticker,
    });
    return {
      ok: true,
      ticker,
      price: centsToDollars(position.currentPriceCents).toFixed(2),
      name: position.name,
    };
  } catch (error) {
    return {
      ok: false,
      ticker,
      error: error instanceof Error ? error.message : "Failed to refresh.",
    };
  }
}

export async function refreshAllPositionsAction(): Promise<RefreshAllResult> {
  try {
    const { refreshed, failed } = await refreshAllPositions(deps.stockPositionRepo, deps.marketDataClient);
    revalidatePath(STOCK_ETFS_MODULE_PATH);
    return { ok: true, refreshedCount: refreshed.length, failed };
  } catch (error) {
    return toErrorResult(error, "Failed to refresh positions.");
  }
}

export async function deleteTransactionAction(transactionId: number): Promise<ActionResult> {
  try {
    deleteTransaction(deps.stockPositionRepo, transactionId);
  } catch (error) {
    return toErrorResult(error, "Failed to delete transaction.");
  }
  revalidatePath(STOCK_ETFS_MODULE_PATH);
  return { ok: true };
}
