export type NextDayActionType = "StopLoss" | "TrimProfit" | "Rebalance" | "StrongBuy" | "Hold";

export interface NextDayActionSignal {
  ticker: string;
  type: string;
  shares: number;
  currentPriceCents: number;
  positionValueCents: number;
  allocationPct: number;
  costBasisCents: number;
  totalReturnPct: number;
  action: NextDayActionType;
  reasoning: string;
  detailLog: string;
}

/**
 * The three thresholds that actually drive a decision. `trailing_stop_pct`
 * exists as a setting in the source app but is never read by its own
 * decision logic (STOP LOSS there is a 20-day-SMA breach, not a trailing
 * stop) — dropped here rather than ported as an inert setting.
 */
export interface NextDayActionThresholds {
  profitTargetPct: number;
  stockConcentrationCapPct: number;
  etfConcentrationCapPct: number;
}

export interface ScanStats {
  twentyDaySma: number;
  avgVolume20Day: number;
  closingVolume: number;
  volumeRatio: number;
}
