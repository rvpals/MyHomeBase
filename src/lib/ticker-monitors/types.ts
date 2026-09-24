/**
 * What a monitor watches. All three are about unrealized gain or loss, because
 * that is the figure a decision actually hangs on — a price target means
 * nothing without knowing what you paid, and the reader has already stored it.
 *
 * These strings are written to `inv_ticker_monitors.monitor_type`, so they are
 * storage values: renaming one orphans every existing row.
 */
export const MONITOR_TYPES = [
  /** Unrealized gain approaching a dollar figure. Uses `targetCents`. */
  "gain_near_amount",
  /**
   * Unrealized loss approaching a dollar figure. Uses `targetCents`.
   * A target of 0 is the useful case: the bad one has nearly recovered.
   */
  "loss_near_amount",
  /** Unrealized gain approaching a percentage of cost basis. Uses `targetPct`. */
  "gain_near_pct_of_cost",
] as const;

/**
 * Derived from the array rather than declared beside it, following
 * `ATTENDANCE_STATUSES` — that is what keeps the list the schema validates
 * against and the type the code checks against from ever disagreeing.
 */
export type MonitorType = (typeof MONITOR_TYPES)[number];

/** The default band: "near" means within 5% of the target. */
export const DEFAULT_BAND_PCT = 5;

export interface TickerMonitor {
  id: number;
  ticker: string;
  monitorType: MonitorType;
  /** The target in cents, for the two amount types. 0 for the percent type. */
  targetCents: number;
  /** The target percentage, for the percent type. 0 for the amount types. */
  targetPct: number;
  /** How close counts as "near", as a percent. See `DEFAULT_BAND_PCT`. */
  bandPct: number;
  isEnabled: boolean;
  /**
   * The fire-once latch. True while the condition has already been reported and
   * not yet cleared — see migrations/0110. Distinct from "is true right now",
   * which is derived live by the evaluator.
   */
  isTriggered: boolean;
  lastTriggeredAt?: string;
  /** The sentence filed when it last fired. Blank if it never has. */
  lastMessage: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * What a monitor is evaluated against: one ticker's holdings, summed over every
 * account that holds it.
 *
 * A plain data shape rather than a `StockPosition[]`, so the evaluator is a pure
 * function over two numbers and cannot accidentally depend on the positions
 * module's wider surface.
 */
export interface TickerValuation {
  ticker: string;
  /** Signed — negative is a loss. */
  unrealizedGainLossCents: number;
  /** Total cost basis. 0 means unknown, not free — no monitor fires against it. */
  costCents: number;
}

/** One monitor's verdict at a moment in time. */
export interface MonitorEvaluation {
  monitorId: number;
  /** Is the condition true *right now*? What the warning icon renders from. */
  isNear: boolean;
  /**
   * Should this fire a message? True only on the transition into the band —
   * `isNear && !monitor.isTriggered`. The difference between the two is what
   * keeps one condition from filing a message on every refresh.
   */
  shouldNotify: boolean;
  /** The sentence to file and to show in the warning modal. */
  message: string;
}

/** What one refresh's monitor pass did. */
export interface MonitorRunResult {
  /** How many enabled monitors were evaluated. */
  evaluated: number;
  /** How many fired — i.e. filed a message this run. */
  triggered: number;
  /** How many were re-armed by their value leaving the band. */
  cleared: number;
  /** The tickers that fired, for the caller's status line. */
  triggeredTickers: string[];
}
