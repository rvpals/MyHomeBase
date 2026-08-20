// Favorite tickers: one bit per symbol, for quick access from the dashboard.
//
// Thin by design. There is no business rule here beyond "normalize the symbol and
// validate it before it becomes a row" — the interesting decisions were schema
// ones and live in migrations/0058_create_ticker_favorites.md. What this module
// buys is that the normalization happens in exactly one place, so the web app and
// the CLI can't disagree about whether `aapl` and `AAPL` are the same favorite.

import { normalizeTicker } from "@/lib/ticker-profiles";
import type { TickerFavoriteRepository } from "./ports";
import { favoriteTickerSchema } from "./schema";
import type { TickerFavorite } from "./types";

/** Every favorite, newest first. */
export function listFavorites(repo: TickerFavoriteRepository): TickerFavorite[] {
  return repo.list();
}

/** Just the symbols, for a caller that only needs the jump list. */
export function listFavoriteTickers(repo: TickerFavoriteRepository): string[] {
  return repo.list().map((favorite) => favorite.ticker);
}

/**
 * Whether this symbol is starred. Normalizes first, so a caller that hasn't is
 * not silently told "no".
 */
export function isFavorite(repo: TickerFavoriteRepository, rawTicker: string): boolean {
  const ticker = normalizeTicker(rawTicker);
  if (ticker === "") return false;
  return repo.isFavorite(ticker);
}

/**
 * Flips the star and returns the state it landed in.
 *
 * Returning the new state rather than void is what lets the one round trip serve
 * a toggle button: the caller renders the answer instead of following up with a
 * read, and an optimistic UI has something authoritative to reconcile against.
 *
 * Reads the current state and writes the opposite, which is a race if two clients
 * press the same star at once. Accepted: both writes are idempotent, so the
 * outcome is one of the two states a user asked for rather than a corrupt row —
 * and this is a household app where the second client is the same person on their
 * phone.
 */
export function toggleFavorite(repo: TickerFavoriteRepository, rawTicker: string): boolean {
  const ticker = favoriteTickerSchema.parse(normalizeTicker(rawTicker));

  if (repo.isFavorite(ticker)) {
    repo.remove(ticker);
    return false;
  }
  repo.add(ticker);
  return true;
}

/**
 * Stars a symbol whatever its current state, and reports whether that changed
 * anything.
 *
 * Separate from `toggleFavorite` because a toggle is the wrong primitive for a
 * caller that knows what it wants — a CLI `favorite add AAPL` run twice should
 * leave the symbol starred, not unstar it.
 */
export function addFavorite(repo: TickerFavoriteRepository, rawTicker: string): boolean {
  const ticker = favoriteTickerSchema.parse(normalizeTicker(rawTicker));
  if (repo.isFavorite(ticker)) return false;
  repo.add(ticker);
  return true;
}

/** Unstars a symbol, reporting whether it was starred to begin with. */
export function removeFavorite(repo: TickerFavoriteRepository, rawTicker: string): boolean {
  const ticker = favoriteTickerSchema.parse(normalizeTicker(rawTicker));
  if (!repo.isFavorite(ticker)) return false;
  repo.remove(ticker);
  return true;
}
