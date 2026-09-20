// Cached brand artwork for the market indexes on the Stocks dashboard.
//
// Separate from `ticker-logos` on purpose. An index is not a ticker: `^GSPC`,
// `GC=F` and `DX-Y.NYB` are provider symbols, not companies, so there is no
// stock-logo endpoint to ask and the ticker validator rejects every one of
// them. What an index *does* have is an organisation behind it — S&P Global,
// Nasdaq, Cboe, the Treasury — and that organisation has a website with a
// favicon. So the lookup key here is a domain, taken from the catalogue,
// never derived from the symbol.

/** Image bytes for one index, as stored and as served. */
export interface IndexLogoImage {
  data: Buffer;
  mimeType: string;
}

/**
 * A cache entry. `image` is undefined when the lookup found nothing — a
 * recorded outcome rather than a miss, so the same symbol isn't re-requested on
 * every expand of the card.
 */
export interface IndexLogoRecord {
  symbol: string;
  image?: IndexLogoImage;
  source: string;
  fetchedAt: string;
}
