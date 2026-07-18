// Pure — no I/O. Ported from the source PWA's next-day-actions.js scan logic.
import { formatCents } from "@/lib/shared/money";
import type { NextDayActionSignal, NextDayActionThresholds, NextDayActionType, ScanStats } from "./types";

const VOLUME_SPIKE_THRESHOLD = 1.5;
const SCAN_WINDOW = 20;

/** 20-day SMA of closes + 20-day average volume, from a daily price history (most recent last). */
export function computeScanStats(history: { closeCents: number; volume?: number }[]): ScanStats {
  const window = history.slice(-SCAN_WINDOW);
  if (window.length === 0) {
    return { twentyDaySma: 0, avgVolume20Day: 0, closingVolume: 0, volumeRatio: 0 };
  }

  const twentyDaySma = window.reduce((sum, point) => sum + point.closeCents, 0) / window.length;
  const avgVolume20Day =
    window.reduce((sum, point) => sum + (point.volume ?? 0), 0) / window.length;
  const closingVolume = window[window.length - 1].volume ?? 0;
  const volumeRatio = avgVolume20Day > 0 ? closingVolume / avgVolume20Day : 0;

  return { twentyDaySma, avgVolume20Day, closingVolume, volumeRatio };
}

export interface EvaluatePositionInput {
  ticker: string;
  type: string;
  shares: number;
  currentPriceCents: number;
  positionValueCents: number;
  allocationPct: number;
  costBasisCents: number;
  totalReturnPct: number;
  /** Undefined when the market-data fetch for this ticker failed — falls back to a two-check evaluation. */
  scanStats?: ScanStats;
  thresholds: NextDayActionThresholds;
}

const ACTION_LABELS: Record<NextDayActionType, string> = {
  StopLoss: "STOP LOSS",
  TrimProfit: "TRIM PROFITS",
  Rebalance: "REBALANCE",
  StrongBuy: "STRONG BUY",
  Hold: "HOLD",
};

/** The Stop Loss -> Trim Profit -> Rebalance -> Strong Buy -> Hold decision tree, plus a human-readable log. */
export function evaluatePosition(input: EvaluatePositionInput): NextDayActionSignal {
  const cap = input.type === "ETF" ? input.thresholds.etfConcentrationCapPct : input.thresholds.stockConcentrationCapPct;
  const returnSign = input.totalReturnPct >= 0 ? "+" : "";

  const lines: string[] = [
    `=== ${input.ticker} (${input.type}) ===`,
    `Current Price: ${formatCents(input.currentPriceCents)}`,
    `Shares: ${input.shares}`,
    `Position Value: ${formatCents(input.positionValueCents)}`,
    `Cost Basis (avg buy): ${formatCents(input.costBasisCents)}`,
    `Total Return: ${returnSign}${input.totalReturnPct.toFixed(2)}%`,
    `Allocation: ${input.allocationPct.toFixed(2)}%`,
    "",
  ];

  let action: NextDayActionType;
  let reasoning: string;

  if (input.scanStats && input.scanStats.twentyDaySma > 0) {
    const { twentyDaySma, avgVolume20Day, closingVolume, volumeRatio } = input.scanStats;
    lines.push(
      "--- Yahoo Finance Scan Data ---",
      `20-Day SMA: ${formatCents(Math.round(twentyDaySma))}`,
      `20-Day Avg Volume: ${Math.round(avgVolume20Day).toLocaleString()}`,
      `Today's Closing Volume: ${closingVolume.toLocaleString()}`,
      `Volume Ratio: ${volumeRatio.toFixed(2)}x`,
      "",
    );

    const belowSma = input.currentPriceCents < twentyDaySma;
    const aboveProfit = input.totalReturnPct >= input.thresholds.profitTargetPct;
    const overCap = input.allocationPct > cap;
    const volumeSpike = volumeRatio >= VOLUME_SPIKE_THRESHOLD;

    lines.push(
      "--- Tier A: Risk Check ---",
      `Price vs 20-Day SMA: ${formatCents(input.currentPriceCents)} ${belowSma ? "<" : ">="} ${formatCents(Math.round(twentyDaySma))} -> ${belowSma ? "STOP LOSS TRIGGERED" : "OK"}`,
      `Return ${returnSign}${input.totalReturnPct.toFixed(1)}% vs Target +${input.thresholds.profitTargetPct}% -> ${aboveProfit ? "TRIM PROFIT TRIGGERED" : "OK"}`,
      "",
      "--- Tier B: Concentration Check ---",
      `Allocation ${input.allocationPct.toFixed(1)}% vs ${input.type} Cap ${cap}% -> ${overCap ? "REBALANCE TRIGGERED" : "OK"}`,
      "",
      "--- Tier C: Momentum Check ---",
      `Volume Ratio ${volumeRatio.toFixed(2)}x vs Threshold ${VOLUME_SPIKE_THRESHOLD.toFixed(2)}x -> ${volumeSpike ? "STRONG BUY TRIGGERED" : "OK"}`,
    );

    if (belowSma) {
      action = "StopLoss";
      reasoning = `Price (${formatCents(input.currentPriceCents)}) closed below 20-day SMA (${formatCents(Math.round(twentyDaySma))}).`;
    } else if (aboveProfit) {
      action = "TrimProfit";
      reasoning = `Return ${returnSign}${input.totalReturnPct.toFixed(1)}% exceeds target of +${input.thresholds.profitTargetPct}%.`;
    } else if (overCap) {
      action = "Rebalance";
      reasoning = `${input.type} allocation ${input.allocationPct.toFixed(1)}% exceeds cap of ${cap}%.`;
    } else if (volumeSpike) {
      action = "StrongBuy";
      reasoning = `Volume spike! Closing volume was ${volumeRatio.toFixed(1)}x its 20-day average.`;
    } else {
      action = "Hold";
      reasoning = "Position is healthy. Within all thresholds.";
    }
  } else {
    lines.push("(Scan data unavailable — market-data fetch failed)");
    const aboveProfit = input.totalReturnPct >= input.thresholds.profitTargetPct;
    const overCap = input.allocationPct > cap;

    if (aboveProfit) {
      action = "TrimProfit";
      reasoning = `Return ${returnSign}${input.totalReturnPct.toFixed(1)}% exceeds target of +${input.thresholds.profitTargetPct}%.`;
    } else if (overCap) {
      action = "Rebalance";
      reasoning = `${input.type} allocation ${input.allocationPct.toFixed(1)}% exceeds cap of ${cap}%.`;
    } else {
      action = "Hold";
      reasoning = "Position is healthy. Within all thresholds.";
    }
  }

  lines.push("", `>>> RESULT: ${ACTION_LABELS[action]}`);

  return {
    ticker: input.ticker,
    type: input.type,
    shares: input.shares,
    currentPriceCents: input.currentPriceCents,
    positionValueCents: input.positionValueCents,
    allocationPct: input.allocationPct,
    costBasisCents: input.costBasisCents,
    totalReturnPct: input.totalReturnPct,
    action,
    reasoning,
    detailLog: lines.join("\n"),
  };
}
