export interface Quote {
  ticker: string;
  priceCents: number;
  previousCloseCents: number;
  shortName?: string;
  dayHighCents: number;
  dayLowCents: number;
  dividendRateCents: number;
}

/** A corporate action or a reported quarter — the dated things that move a price. */
export type MarketEventKind = "dividend" | "split" | "earnings";

export interface MarketEvent {
  /** Epoch seconds of the event's date. */
  timestamp: number;
  kind: MarketEventKind;
  /** Dividend per share, in cents. Only on `dividend`. */
  amountCents?: number;
  /** Split ratio as the provider words it, e.g. "4:1". Only on `split`. */
  ratio?: string;
  /** Reported EPS in cents. Only on `earnings`, and only once reported. */
  epsActualCents?: number;
  /** What analysts expected, in cents. Only on `earnings`. */
  epsEstimateCents?: number;
}

/** One daily close, used as the raw series for volatility/correlation/Sharpe/scan stats. */
export interface PricePoint {
  /** Epoch seconds. */
  timestamp: number;
  closeCents: number;
  /** Shares traded that day. Undefined where the provider didn't report it. */
  volume?: number;
}
