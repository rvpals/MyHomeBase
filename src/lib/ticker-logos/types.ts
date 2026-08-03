/** Image bytes for one ticker, as stored and as served. */
export interface TickerLogoImage {
  data: Buffer;
  mimeType: string;
}

/**
 * A cache entry. `image` is undefined when the lookup found nothing — that's a
 * recorded outcome, not a miss, so it stops the same ticker being re-requested
 * on every page render.
 */
export interface TickerLogoRecord {
  ticker: string;
  image?: TickerLogoImage;
  source: string;
  fetchedAt: string;
}
