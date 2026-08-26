// Prints the favorites jump list with its last-refreshed prices — the same
// use-case the star menu renders, formatted for a terminal.
//
//   npm run cli -- favorite-quotes
//
// Prices come from `stk_positions`, so they're as fresh as the last
// `refresh-positions` run and a favorite you don't hold shows a dash.

import { formatCents } from "@/lib/shared/money";
import { listFavoriteQuotes } from "@/lib/ticker-favorites";
import { deps } from "@/lib/wiring";

function signed(cents: number): string {
  return `${cents >= 0 ? "+" : "-"}${formatCents(Math.abs(cents))}`;
}

export async function favoriteQuotesCommand(): Promise<void> {
  const favorites = listFavoriteQuotes(deps.tickerFavoriteRepo, deps.stockPositionRepo);

  if (favorites.length === 0) {
    console.log("No favorites yet — open a ticker and press the star in its header.");
    return;
  }

  for (const favorite of favorites) {
    if (favorite.priceCents == null) {
      console.log(`  ${favorite.ticker.padEnd(8)} —        (not held)`);
      continue;
    }

    console.log(
      `  ${favorite.ticker.padEnd(8)} ${formatCents(favorite.priceCents)}` +
        ` · ${signed(favorite.dayGainLossCents ?? 0)}` +
        ` (${(favorite.dayChangePct ?? 0).toFixed(2)}%)` +
        ` · as of ${favorite.updatedAt ?? "unknown"}` +
        (favorite.name ? ` · ${favorite.name}` : ""),
    );
  }
}
