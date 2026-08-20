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
