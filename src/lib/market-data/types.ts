export interface Quote {
  ticker: string;
  priceCents: number;
  previousCloseCents: number;
  shortName?: string;
  dayHighCents: number;
  dayLowCents: number;
  dividendRateCents: number;
}

/** One daily close, used as the raw series for volatility/correlation/Sharpe/scan stats. */
export interface PricePoint {
  /** Epoch seconds. */
  timestamp: number;
  closeCents: number;
  /** Shares traded that day. Undefined where the provider didn't report it. */
  volume?: number;
}
