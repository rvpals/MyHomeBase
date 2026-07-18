"use server";

import { revalidatePath } from "next/cache";
import { lookupQuote } from "@/lib/market-data";
import {
  createTransaction,
  deletePosition,
  deleteTransaction,
  refreshAllPositions,
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

export interface PositionFormInput {
  ticker: string;
  name: string;
  type: PositionType;
  currentPrice: string;
  quantity: string;
  dayGainLoss: string;
  dayHigh: string;
  dayLow: string;
  dividendRate: string;
}

export interface TransactionFormInput {
  transactionAt: string;
  action: TransactionAction;
  ticker: string;
  numberOfShares: string;
  pricePerShare: string;
  note?: string;
}

function toErrorResult(error: unknown, fallback: string): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

export async function upsertPositionAction(input: PositionFormInput): Promise<ActionResult> {
  try {
    upsertPosition(deps.stockPositionRepo, {
      ticker: input.ticker,
      name: input.name,
      type: input.type,
      currentPriceCents: dollarsToCents(input.currentPrice || "0"),
      quantity: Number(input.quantity || "0"),
      dayGainLossCents: dollarsToCents(input.dayGainLoss || "0"),
      dayHighCents: dollarsToCents(input.dayHigh || "0"),
      dayLowCents: dollarsToCents(input.dayLow || "0"),
      dividendRateCents: dollarsToCents(input.dividendRate || "0"),
    });
  } catch (error) {
    return toErrorResult(error, "Failed to save position.");
  }
  revalidatePath(STOCK_ETFS_MODULE_PATH);
  return { ok: true };
}

export async function deletePositionAction(ticker: string): Promise<ActionResult> {
  try {
    deletePosition(deps.stockPositionRepo, ticker);
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
