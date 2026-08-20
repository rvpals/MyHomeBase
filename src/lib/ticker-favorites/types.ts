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
