/**
 * What a watch-list row can watch for.
 *
 * These strings are written to `inv_stock_watch_list_items.watch_kind`, so they
 * are storage values: renaming one orphans every existing row.
 *
 * Distinct from `MONITOR_TYPES` in `@/lib/ticker-monitors`, which watches
 * unrealized gain on a position you hold. A watch-list row is a ticker you are
 * considering — there is no cost basis, so price is the only thing there is to
 * watch. See `migrations/0111_add_watch_condition_to_watch_list_items.md`.
 */
export const WATCH_KINDS = [
  /** The live price reaches `watchValue` (cents), from either direction. */
  "price",
  /** The live price sits inside `[watchValue, watchValueHigh]` (cents). */
  "price_range",
  /** A dividend is issued after the row was added. Reads no value. */
  "dividend",
  /** A split happens after the row was added. Reads no value. */
  "split",
  /** The price has swung ±`watchValue` percent since added. */
  "gain_loss_pct",
  /** The price has swung ±`watchValue` cents per share since added. */
  "gain_loss_price",
] as const;

/**
 * Derived from the array rather than declared beside it, following
 * `MONITOR_TYPES` — that is what keeps the list the schema validates against
 * and the type the code checks against from ever disagreeing.
 */
export type WatchKind = (typeof WATCH_KINDS)[number];

/**
 * Not watching. The default, and the common case — a watch list is still
 * primarily a list.
 *
 * The empty string rather than `null` so the column is `NOT NULL` and every
 * read has one spelling of "no watch" to handle.
 */
export const NO_WATCH = "" as const;

/** What a row's `watchKind` may be: one of the kinds, or nothing. */
export type WatchKindOrNone = WatchKind | typeof NO_WATCH;

/** The kinds that read no value at all — the two corporate-action ones. */
export const EVENT_WATCH_KINDS: readonly WatchKind[] = ["dividend", "split"];

/** True when the kind is watching for a dated corporate action rather than a price. */
export function isEventWatchKind(kind: WatchKindOrNone): kind is "dividend" | "split" {
  return kind === "dividend" || kind === "split";
}

export interface StockWatchList {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface StockWatchListItem {
  id: number;
  watchListId: number;
  ticker: string;
  shares: number;
  priceWhenAddedCents: number;
  addedDate: string;
  reminderAt?: string;
  reminderMessage: string;

  /** What this row watches for. `NO_WATCH` when it watches nothing. */
  watchKind: WatchKindOrNone;
  /**
   * The target, in whichever unit `watchKind` reads: cents for `price`,
   * `price_range` (the low bound) and `gain_loss_price`; percent for
   * `gain_loss_pct`; unread for the event kinds.
   */
  watchValue: number;
  /** The high bound, cents. Only `price_range` reads it. */
  watchValueHigh: number;
  /**
   * The fire-once latch. True while the condition has already been reported and
   * not yet cleared — see migrations/0111. Distinct from "is true right now",
   * which is derived live by the evaluator.
   */
  watchIsTriggered: boolean;
  /**
   * When it last fired. For `dividend` and `split` this doubles as the **event
   * cursor**: the row only fires for an event dated after it.
   */
  watchLastTriggeredAt?: string;
  /** The sentence filed when it last fired. Blank if it never has. */
  watchLastMessage: string;

  createdAt: string;
  updatedAt: string;
}

/**
 * One watch's verdict at a moment in time.
 *
 * The same two-field shape as `MonitorEvaluation`, and for the same reason:
 * `isActive` answers "is this true now" and drives the marker beside the row,
 * `shouldNotify` answers "true and not already reported" and is the only thing
 * that files a message.
 */
export interface WatchEvaluation {
  itemId: number;
  isActive: boolean;
  shouldNotify: boolean;
  message: string;
  /**
   * For the event kinds, the date of the event that fired, stored as the new
   * cursor. Absent for the price kinds, which latch on the condition itself.
   */
  eventDate?: string;
}

/** What one refresh's watch-list pass did. */
export interface WatchRunResult {
  /** How many watched rows were evaluated. */
  evaluated: number;
  /** How many fired — i.e. filed a message this run. */
  triggered: number;
  /** How many were re-armed by their condition ceasing to hold. */
  cleared: number;
  /** The tickers that fired, for the caller's status line. */
  triggeredTickers: string[];
}
