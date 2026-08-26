/**
 * A favorited symbol.
 *
 * Deliberately thin — a favorite carries nothing but the ticker and when it was
 * starred. Anything more (shares, a price to compare against, a reminder) is a
 * watch-list item's job; see `migrations/0058_create_ticker_favorites.md` for why
 * the two stay separate.
 */
export interface TickerFavorite {
  ticker: string;
  createdAt: string;
}

/**
 * A favorite with its last-refreshed price attached.
 *
 * The price is whatever `refresh-positions` last wrote to `stk_positions` — this
 * is a *stored* figure, never a live fetch, so opening the jump list costs no
 * network round-trip and shows the same numbers the positions table shows.
 *
 * Everything but `ticker` is optional because a favorite need not be a holding.
 * Starring a symbol you don't own is the normal case for a watch candidate, and
 * there is no price cache for unheld symbols — such a row renders as a jump
 * target with a dash where the price would be, which is why nothing here is
 * required.
 */
export interface FavoriteQuote {
  ticker: string;
  /** The broker's name for the holding, when we hold it. */
  name?: string;
  /** Last-refreshed price per share. Undefined when the symbol isn't held. */
  priceCents?: number;
  /**
   * The day's move on the whole holding — not per share — summed across accounts,
   * matching `dayGainLossCents` in `stk_positions`.
   */
  dayGainLossCents?: number;
  /** The day's move as a percent, against the value before the move. */
  dayChangePct?: number;
  /** When the price was last refreshed, ISO. The honest age of the figure. */
  updatedAt?: string;
}
