"use server";

import { revalidatePath } from "next/cache";
import {
  clearCorrelationCache,
  clearVolatilityCache,
  computeCorrelationMatrix,
  computeSharpe,
  computeVolatility,
  saveVolatilityCache,
  type CorrelationResult,
  type SharpeResult,
  type VolatilityResult,
} from "@/lib/stock-analytics";
import { deps } from "@/lib/wiring";

const STOCK_ETFS_MODULE_PATH = "/modules/stock-etfs";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function toErrorResult(error: unknown, fallback: string): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

export interface RecomputeVolatilityResult extends ActionResult {
  computedCount?: number;
  failed?: { ticker: string; error: string }[];
}

export async function recomputeAllVolatilityAction(): Promise<RecomputeVolatilityResult> {
  const positions = deps.stockPositionRepo.listPositions();
  const results: VolatilityResult[] = [];
  const failed: { ticker: string; error: string }[] = [];

  for (const position of positions) {
    try {
      results.push(await computeVolatility(deps.marketDataClient, position));
    } catch (error) {
      failed.push({ ticker: position.ticker, error: error instanceof Error ? error.message : String(error) });
    }
  }

  try {
    saveVolatilityCache(deps.stockAnalyticsRepo, results);
  } catch (error) {
    return toErrorResult(error, "Failed to save volatility results.");
  }

  revalidatePath(STOCK_ETFS_MODULE_PATH);
  return { ok: true, computedCount: results.length, failed };
}

export async function clearVolatilityCacheAction(): Promise<ActionResult> {
  try {
    clearVolatilityCache(deps.stockAnalyticsRepo);
  } catch (error) {
    return toErrorResult(error, "Failed to clear volatility cache.");
  }
  revalidatePath(STOCK_ETFS_MODULE_PATH);
  return { ok: true };
}

export interface ComputeCorrelationResult extends ActionResult {
  result?: CorrelationResult;
}

export async function computeCorrelationAction(): Promise<ComputeCorrelationResult> {
  try {
    const positions = deps.stockPositionRepo.listPositions();
    const result = await computeCorrelationMatrix(deps.stockAnalyticsRepo, deps.marketDataClient, positions);
    revalidatePath(STOCK_ETFS_MODULE_PATH);
    return { ok: true, result };
  } catch (error) {
    return toErrorResult(error, "Failed to compute correlation matrix.");
  }
}

export async function clearCorrelationCacheAction(): Promise<ActionResult> {
  try {
    clearCorrelationCache(deps.stockAnalyticsRepo);
  } catch (error) {
    return toErrorResult(error, "Failed to clear correlation cache.");
  }
  revalidatePath(STOCK_ETFS_MODULE_PATH);
  return { ok: true };
}

export interface ComputeSharpeResult extends ActionResult {
  result?: SharpeResult;
}

export async function computeSharpeAction(
  riskFreeRatePct: string,
  lookbackDays: string,
): Promise<ComputeSharpeResult> {
  try {
    const positions = deps.stockPositionRepo.listPositions();
    const result = await computeSharpe(deps.stockAnalyticsRepo, deps.marketDataClient, positions, {
      riskFreeRate: Number(riskFreeRatePct || "5") / 100,
      lookbackDays: Number(lookbackDays || "365"),
    });
    revalidatePath(STOCK_ETFS_MODULE_PATH);
    return { ok: true, result };
  } catch (error) {
    return toErrorResult(error, "Failed to compute Sharpe ratio.");
  }
}
