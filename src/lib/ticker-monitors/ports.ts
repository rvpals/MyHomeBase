import type { CreateMonitor, UpdateMonitor } from "./schema";
import type { TickerMonitor } from "./types";

/** What the monitor use-cases need from storage. Wired in `wiring.ts`. */
export interface TickerMonitorRepository {
  /** Every monitor for one symbol, oldest first — the order the screen lists. */
  listByTicker(ticker: string): TickerMonitor[];
  /**
   * Every enabled monitor across every ticker. What a refresh pass iterates.
   * Disabled rows are filtered in SQL rather than by the caller, so a run never
   * loads rows it would immediately skip.
   */
  listEnabled(): TickerMonitor[];
  getById(id: number): TickerMonitor | undefined;
  /** Both take the **validated** shapes — the use-case parses before calling. */
  create(input: CreateMonitor): TickerMonitor;
  update(input: UpdateMonitor): TickerMonitor;
  setEnabled(id: number, isEnabled: boolean): void;
  delete(id: number): void;
  /**
   * Writes the fire-once latch, and the sentence that went with it.
   *
   * Separate from `update`, which is the reader editing their configuration:
   * these columns are the evaluator's bookkeeping, and a refresh must not have
   * to round-trip a whole monitor to stamp one of them.
   */
  setTriggered(id: number, isTriggered: boolean, message: string): void;
}

/**
 * The one thing this module needs from the positions side: what a symbol is
 * worth and what it cost.
 *
 * A narrow port rather than a dependency on `StockPositionRepository` wholesale,
 * exactly as `FavoritePositionReader` is in `ticker-favorites` — a monitor test
 * wires a two-line fake instead of implementing a dozen transaction methods it
 * never calls, and the real `SqliteStockPositionRepository` satisfies this
 * structurally, so wiring passes the same instance the positions module uses.
 */
export interface MonitorPositionReader {
  listPositionsByTicker(ticker: string): readonly {
    unrealizedGainLossCents: number;
    costCents: number;
  }[];
}
