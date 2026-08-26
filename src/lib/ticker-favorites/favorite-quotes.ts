// Last-refreshed prices for the favorites jump list.
//
// No provider call: the price shown is the one `refresh-positions` last wrote to
// `stk_positions`. That keeps opening the menu free, and — more importantly —
// keeps it *consistent*, since the star list and the positions table then quote
// the same number from the same read rather than differing by whatever moved
// between two fetches.
//
// The consequence, and it's deliberate: a favorite that isn't a holding has no
// stored price and comes back price-less. See `FavoriteQuote`.

import { changePct, type StockPosition } from "@/lib/stock-positions";
import type { FavoritePositionReader, TickerFavoriteRepository } from "./ports";
import { listFavoriteTickers } from "./ticker-favorites";
import type { FavoriteQuote } from "./types";

/**
 * Rolls one symbol's holdings across accounts into a single priced row.
 *
 * A ticker can be held in several accounts. `currentPriceCents` is per share and
 * identical on each of those rows, so it's read from the first rather than summed;
 * the day's move is a per-account amount, so it is summed. `updatedAt` reports the
 * *oldest* of the rows: the figure is only as fresh as its stalest input, and
 * claiming the newest would overstate it.
 */
export function summarizeFavoritePosition(
  ticker: string,
  positions: StockPosition[],
): FavoriteQuote {
  if (positions.length === 0) return { ticker };

  const dayGainLossCents = positions.reduce((total, row) => total + row.dayGainLossCents, 0);
  const valueCents = positions.reduce((total, row) => total + row.valueCents, 0);

  return {
    ticker,
    name: positions.find((row) => row.name !== "")?.name,
    priceCents: positions[0].currentPriceCents,
    dayGainLossCents,
    dayChangePct: changePct(valueCents, dayGainLossCents),
    updatedAt: positions.map((row) => row.updatedAt).sort()[0],
  };
}

/**
 * Every favorite, newest first, each carrying its last-refreshed price where the
 * symbol is held.
 *
 * Synchronous, because this is two DB reads and no network — which is the whole
 * point of reading the stored price rather than quoting live.
 */
export function listFavoriteQuotes(
  repo: TickerFavoriteRepository,
  positions: FavoritePositionReader,
): FavoriteQuote[] {
  return listFavoriteTickers(repo).map((ticker) =>
    summarizeFavoritePosition(ticker, positions.listPositionsByTicker(ticker)),
  );
}
