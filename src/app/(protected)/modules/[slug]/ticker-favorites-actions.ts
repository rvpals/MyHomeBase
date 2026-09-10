"use server";

// The favorite star's actions: read the jump list (with or without prices), ask
// about one symbol, and flip one symbol.
//
// No `revalidatePath` on the toggle, deliberately. The star lives inside the
// ticker viewer dialog and the jump list is fetched when its menu opens, so
// nothing on the underlying page renders from this — revalidating would rebuild
// the whole dashboard to update a control that already knows its own new state.

import {
  listFavoriteQuotes,
  listFavoriteTickers,
  toggleFavorite as toggleFavoriteUseCase,
  isFavorite as isFavoriteUseCase,
  type FavoriteQuote,
} from "@/lib/ticker-favorites";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "../../require-access";

/** The module these actions belong to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "stock-etfs";

export interface ToggleFavoriteResult {
  ok: boolean;
  /** The state the star landed in. Meaningless when `ok` is false. */
  isFavorite: boolean;
  error?: string;
}

/** The favorited symbols, newest first. */
export async function listFavoriteTickersAction(): Promise<string[]> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  return listFavoriteTickers(deps.tickerFavoriteRepo);
}

/**
 * The favorites with their last-refreshed prices, newest first.
 *
 * Reads stored prices only — no provider round-trip — so opening the menu is a
 * DB read and shows the same figures as the positions table. A favorite that
 * isn't held comes back without a price.
 */
export async function listFavoriteQuotesAction(): Promise<FavoriteQuote[]> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  return listFavoriteQuotes(deps.tickerFavoriteRepo, deps.stockPositionRepo);
}

/** Whether one symbol is starred — what the viewer's star renders from on open. */
export async function isFavoriteTickerAction(ticker: string): Promise<boolean> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  return isFavoriteUseCase(deps.tickerFavoriteRepo, ticker);
}

/**
 * Flips the star and reports where it landed.
 *
 * On failure it returns the *current* state rather than guessing, so an
 * optimistic button can roll back to the truth instead of to its own assumption.
 */
export async function toggleFavoriteTickerAction(ticker: string): Promise<ToggleFavoriteResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const isFavorite = toggleFavoriteUseCase(deps.tickerFavoriteRepo, ticker);
    return { ok: true, isFavorite };
  } catch (error) {
    return {
      ok: false,
      isFavorite: isFavoriteUseCase(deps.tickerFavoriteRepo, ticker),
      error: error instanceof Error ? error.message : "Failed to update the favorite.",
    };
  }
}
