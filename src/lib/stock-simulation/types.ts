// A "what if I had bought then" backtest over one symbol, run across several
// windows at once.
//
// The premise, and the one thing to keep straight while reading the rest: a
// range is a *hypothetical entry date*, not a holding period going forward.
// "6 M" means "had you bought at the close six months ago and held to today".
// Every range therefore shares one current price and differs only in what it
// assumes you paid.

/** The windows offered on the screen, in the order they're shown. */
export type SimulationRange =
  | "1wk"
  | "2wk"
  | "1mo"
  | "3mo"
  | "6mo"
  | "1y"
  | "2y"
  | "5y"
  | "10y"
  | "max";

/** One point of a range's normalized price line. */
export interface OverlayPoint {
  /**
   * How far through the range this point sits, 0–100. The x-axis is progress,
   * not a date, because a 1-week line and a 10-year line have to share one
   * axis — see `normalizeSeries`.
   */
  progressPct: number;
  /** Percent change from this range's own buy price. The buy point is 0. */
  changePct: number;
  /** The real close, carried along so a tooltip can show money as well as percent. */
  closeCents: number;
  /** Epoch seconds of the close, for the tooltip's date. */
  timestamp: number;
}

/** One range's backtest, when its history came back usable. */
export interface RangeSimulation {
  range: SimulationRange;
  /** The close at the start of the window — what the simulation assumes you paid. */
  buyPriceCents: number;
  /** The latest close in the window. Shared across ranges in practice. */
  currentPriceCents: number;
  /** `buyPriceCents * shares`. */
  totalCostCents: number;
  /** `currentPriceCents * shares`. */
  currentValueCents: number;
  /** `currentValueCents - totalCostCents`. Negative is a loss. */
  gainLossCents: number;
  /** The same as a percentage of cost. 0 when the buy price is unknown. */
  gainLossPct: number;
  /** Epoch seconds of the buy close, so a card can date its entry point. */
  buyTimestamp: number;
  /** Epoch seconds of the latest close. */
  currentTimestamp: number;
  /** How many closes backed this range — thin history is worth showing. */
  observationCount: number;
  /** The normalized line for the overlay chart. */
  series: OverlayPoint[];
}

/** A range that couldn't be simulated, and why. Reported, never thrown. */
export interface RangeFailure {
  range: SimulationRange;
  reason: string;
}

export interface SimulationResult {
  ticker: string;
  shares: number;
  /** When the run happened, ISO. The prices are only as fresh as this. */
  ranAt: string;
  /** Successful ranges, in the order the ranges are offered. */
  simulations: RangeSimulation[];
  /** Ranges that returned nothing usable — a symbol younger than the window, say. */
  failures: RangeFailure[];
}
