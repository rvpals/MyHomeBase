"use server";

// The dashboard ticker search's one action. Read-only, so there's no
// `revalidatePath` here and no `ActionResult` wrapper — a failed lookup has
// nothing useful to say beyond "no suggestions", and the picker already renders
// that case.

import { listPositions } from "@/lib/stock-positions";
import { listItems, listWatchLists } from "@/lib/stock-watchlist";
import {
  collectKnownTickers,
  isKnownTicker,
  matchTickers,
  tickerQuerySchema,
  type TickerSuggestion,
} from "@/lib/ticker-search";
import { deps } from "@/lib/wiring";

export interface TickerSearchResult {
  suggestions: TickerSuggestion[];
  /** Whether the query is itself an exact known symbol — see `isKnownTicker`. */
  isExactKnown: boolean;
}

/**
 * Every ticker the system knows about: held, watched, or merely profiled.
 *
 * Read whole on each keystroke rather than filtered in SQL, deliberately. The
 * three tables are small (hundreds of rows at most, all local SQLite) and the
 * ranking is a pure function over the merged set — pushing a LIKE into three
 * queries would split that logic across the adapters and buy nothing measurable.
 */
function loadKnownTickers() {
  const positionTickers = listPositions(deps.stockPositionRepo).map((p) => p.ticker);
  const watchListTickers = listWatchLists(deps.stockWatchListRepo).flatMap((list) =>
    listItems(deps.stockWatchListRepo, list.id).map((item) => item.ticker),
  );
  const profileTickers = deps.tickerProfileRepo.list().map((profile) => profile.ticker);

  return collectKnownTickers({ positionTickers, watchListTickers, profileTickers });
}

export async function searchTickersAction(query: string): Promise<TickerSearchResult> {
  const parsed = tickerQuerySchema.safeParse(query);
  if (!parsed.success) return { suggestions: [], isExactKnown: false };

  const known = loadKnownTickers();
  return {
    suggestions: matchTickers(known, parsed.data),
    isExactKnown: isKnownTicker(known, parsed.data),
  };
}
