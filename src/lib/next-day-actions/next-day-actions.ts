import type { MarketDataClient } from "@/lib/market-data";
import type { ModuleSetting } from "@/lib/module-settings";
import { computeAverageCostBasisCents, type StockPositionRepository } from "@/lib/stock-positions";
import { computeScanStats, evaluatePosition } from "./stats";
import type { NextDayActionSignal, NextDayActionThresholds, NextDayActionType } from "./types";

const DEFAULT_THRESHOLDS: NextDayActionThresholds = {
  profitTargetPct: 20,
  stockConcentrationCapPct: 10,
  etfConcentrationCapPct: 25,
};

function readPercentSetting(settings: ModuleSetting[], key: string, fallback: number): number {
  const setting = settings.find((entry) => entry.key === key);
  const parsed = setting ? Number(setting.value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Reads the three configurable thresholds from admin-editable module settings, falling back to defaults. */
export function resolveThresholds(settings: ModuleSetting[]): NextDayActionThresholds {
  return {
    profitTargetPct: readPercentSetting(settings, "profit_target_pct", DEFAULT_THRESHOLDS.profitTargetPct),
    stockConcentrationCapPct: readPercentSetting(
      settings,
      "stock_concentration_cap",
      DEFAULT_THRESHOLDS.stockConcentrationCapPct,
    ),
    etfConcentrationCapPct: readPercentSetting(
      settings,
      "etf_concentration_cap",
      DEFAULT_THRESHOLDS.etfConcentrationCapPct,
    ),
  };
}

const SCAN_HISTORY_RANGE = "1mo";
const SCAN_HISTORY_INTERVAL = "1d";

const ACTION_ORDER: Record<NextDayActionType, number> = {
  StopLoss: 0,
  TrimProfit: 1,
  Rebalance: 2,
  StrongBuy: 3,
  Hold: 4,
};

/**
 * Scans every position with shares > 0 and returns a Stop Loss / Trim Profit /
 * Rebalance / Strong Buy / Hold signal for each, sorted most-urgent first.
 * Tolerates a market-data failure for an individual ticker (falls back to a
 * two-check evaluation for that one) rather than failing the whole scan.
 */
export async function runScan(
  repo: StockPositionRepository,
  client: MarketDataClient,
  thresholds: NextDayActionThresholds,
): Promise<NextDayActionSignal[]> {
  const eligible = repo.listPositions().filter((position) => position.quantity > 0);
  const totalPortfolioValueCents = eligible.reduce((sum, position) => sum + position.valueCents, 0);

  const signals = await Promise.all(
    eligible.map(async (position) => {
      const costBasisCents = computeAverageCostBasisCents(repo.listTransactions(position.ticker)) ?? position.currentPriceCents;
      const allocationPct =
        totalPortfolioValueCents > 0 ? (position.valueCents / totalPortfolioValueCents) * 100 : 0;
      const totalReturnPct =
        costBasisCents > 0 ? ((position.currentPriceCents - costBasisCents) / costBasisCents) * 100 : 0;

      let scanStats;
      try {
        const history = await client.getHistory(position.ticker, SCAN_HISTORY_RANGE, SCAN_HISTORY_INTERVAL);
        scanStats = computeScanStats(history);
      } catch {
        scanStats = undefined;
      }

      return evaluatePosition({
        ticker: position.ticker,
        type: position.type,
        shares: position.quantity,
        currentPriceCents: position.currentPriceCents,
        positionValueCents: position.valueCents,
        allocationPct,
        costBasisCents,
        totalReturnPct,
        scanStats,
        thresholds,
      });
    }),
  );

  return signals.sort(
    (a, b) => ACTION_ORDER[a.action] - ACTION_ORDER[b.action] || b.allocationPct - a.allocationPct,
  );
}
