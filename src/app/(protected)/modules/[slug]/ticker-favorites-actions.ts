"use server";

// The favorite star's two actions: read the jump list, and flip one symbol.
//
// No `revalidatePath` on the toggle, deliberately. The star lives inside the
// ticker viewer dialog and the jump list is fetched when its menu opens, so
// nothing on the underlying page renders from this — revalidating would rebuild
// the whole dashboard to update a control that already knows its own new state.

import {
  listFavoriteTickers,
  toggleFavorite as toggleFavoriteUseCase,
  isFavorite as isFavoriteUseCase,
} from "@/lib/ticker-favorites";
import { deps } from "@/lib/wiring";

export interface ToggleFavoriteResult {
  ok: boolean;
  /** The state the star landed in. Meaningless when `ok` is false. */
  isFavorite: boolean;
  error?: string;
}

/** The favorited symbols, newest first. */
export async function listFavoriteTickersAction(): Promise<string[]> {
  return listFavoriteTickers(deps.tickerFavoriteRepo);
}

/** Whether one symbol is starred — what the viewer's star renders from on open. */
export async function isFavoriteTickerAction(ticker: string): Promise<boolean> {
  return isFavoriteUseCase(deps.tickerFavoriteRepo, ticker);
}

/**
 * Flips the star and reports where it landed.
 *
 * On failure it returns the *current* state rather than guessing, so an
 * optimistic button can roll back to the truth instead of to its own assumption.
 */
export async function toggleFavoriteTickerAction(ticker: string): Promise<ToggleFavoriteResult> {
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
