/**
 * What a monitor watches.
 *
 * The first three are about unrealized gain or loss — the figure a decision
 * about *this holding* hangs on. The last two are about the security itself: a
 * price the reader is waiting for, and a one-day move. Those two need no cost
 * basis, which is why the basis guard in `evaluateMonitor` is per-type (0148).
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
  /**
   * Price per share near a dollar figure. Uses `targetCents` and `bandPct`.
   *
   * Band-based like the amount types, so it is true on approach from **either**
   * side — see 0148. A tight band is how to ask for something near a crossing.
   */
  "price_near_amount",
  /**
   * Price moved `targetPct`% or more against the previous close, in
   * `direction`. Uses `targetPct` and `direction`; **ignores `bandPct`**.
   *
   * A threshold, not a band: "5% either side of a 3% move" would be true from
   * -2% to +8%, i.e. always.
   */
  "day_move_pct",
] as const;

/**
 * Which way a `day_move_pct` monitor watches.
 *
 * `targetPct` is always positive and this carries the sign, so one condition
 * has one spelling — the same rule `loss_near_amount` follows by storing a
 * positive figure for a negative quantity.
 */
export const MOVE_DIRECTIONS = ["up", "down"] as const;

export type MoveDirection = (typeof MOVE_DIRECTIONS)[number];

/**
 * The types measured against money actually put in, which therefore cannot be
 * judged without a cost basis. The other two are facts about the security.
 *
 * A set rather than a condition spelled out at each call site: `evaluateMonitor`
 * and the setup screen both need the same answer, and two copies of it would
 * drift the moment a sixth type is added.
 */
const BASIS_REQUIRED: ReadonlySet<string> = new Set<MonitorType>([
  "gain_near_amount",
  "loss_near_amount",
  "gain_near_pct_of_cost",
]);

/** Does this monitor need a cost basis to mean anything? See 0148. */
export function needsCostBasis(monitorType: MonitorType): boolean {
  return BASIS_REQUIRED.has(monitorType);
}

/** Does this monitor read `bandPct`? False only for the threshold type. */
export function usesBand(monitorType: MonitorType): boolean {
  return monitorType !== "day_move_pct";
}

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
  /**
   * The target percentage, for `gain_near_pct_of_cost` and `day_move_pct`.
   * 0 for the amount types. Always positive — see `MOVE_DIRECTIONS`.
   */
  targetPct: number;
  /**
   * How close counts as "near", as a percent. See `DEFAULT_BAND_PCT`.
   * Ignored by `day_move_pct`, which is a threshold — see `usesBand`.
   */
  bandPct: number;
  /**
   * Which way a `day_move_pct` monitor watches. Empty for every other type,
   * matching the column's blank-string sentinel (0148).
   */
  direction: MoveDirection | "";
  isEnabled: boolean;
  /**
   * Also interrupt the home screen when this fires, instead of only filing a
   * message — see migrations/0149.
   *
   * **Delivery, not condition.** It changes nothing about what is watched or
   * when the monitor is true, so the evaluator never reads it; only
   * `runMonitors` does, when it decides how to report. Any of the five types
   * can carry it.
   */
  isPopup: boolean;
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
  /**
   * Total cost basis. 0 means unknown, not free — no *gain/loss* monitor fires
   * against it. The price types do not read this at all (0148).
   */
  costCents: number;
  /**
   * Price per share. 0 means unknown — a ticker held in several accounts should
   * report one price, so this is the price of the first holding that states one
   * rather than a sum. See `valuationFromHoldings`.
   */
  pricePerShareCents: number;
  /**
   * Yesterday's close, per share. `undefined` when it cannot be derived — no
   * shares held, so `dayGainLoss / quantity` has no answer.
   *
   * Not stored anywhere: recovered from `dayGainLossCents`, which the refresh
   * writes as `(price - previousClose) * quantity`. That is also why it is the
   * *previous close* and not today's open, which nothing stores.
   */
  previousClosePerShareCents?: number;
  /**
   * Today's move as a signed percent against the previous close — negative is
   * down. `undefined` when there is no baseline to measure from.
   */
  dayChangePct?: number;
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
