import type { StockPosition } from "@/lib/stock-positions";
import type { TickerFavorite } from "./types";

export interface TickerFavoriteRepository {
  /** Every favorite, newest first — the order the jump list reads in. */
  list(): TickerFavorite[];
  isFavorite(ticker: string): boolean;
  /** Idempotent: starring an already-favorite symbol is not an error. */
  add(ticker: string): void;
  /** Idempotent: removing one that isn't there is not an error. */
  remove(ticker: string): void;
}

/**
 * The one thing this module needs from the positions side: a symbol's holdings.
 *
 * Declared here as a narrow port rather than depending on
 * `StockPositionRepository` wholesale, so a favorites test wires a two-line fake
 * instead of implementing a dozen transaction methods it never calls. The real
 * `SqliteStockPositionRepository` satisfies it structurally, so wiring passes the
 * same instance the positions module already uses.
 */
export interface FavoritePositionReader {
  listPositionsByTicker(ticker: string): StockPosition[];
}
