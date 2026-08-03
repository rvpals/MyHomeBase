// Ticker logo lookup: serve from the cache, and only reach out to the logo
// service when there's nothing usable stored. Pure orchestration — the HTTP call
// is behind TickerLogoClient and storage behind TickerLogoRepository.

import type { TickerLogoClient, TickerLogoRepository } from "./ports";
import type { TickerLogoImage } from "./types";

/** What a stored image may be. Anything else is treated as "no logo". */
export const LOGO_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export const MAX_LOGO_BYTES = 256 * 1024;

/**
 * Tickers are user-supplied and get interpolated into a third-party URL, so the
 * shape is enforced rather than trusted. Covers real symbols including dotted
 * classes (BRK.B) and hyphens.
 */
const TICKER_PATTERN = /^[A-Z0-9.\-]{1,15}$/;

/** A recorded "no logo" is retried after this long, rather than never. */
const NEGATIVE_CACHE_DAYS = 30;

export function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

export function isValidTicker(ticker: string): boolean {
  return TICKER_PATTERN.test(normalizeTicker(ticker));
}

/** True when a stored image is one we're willing to serve. */
export function isAcceptableLogo(image: TickerLogoImage): boolean {
  return (
    (LOGO_MIME_TYPES as readonly string[]).includes(image.mimeType) &&
    image.data.length > 0 &&
    image.data.length <= MAX_LOGO_BYTES
  );
}

function isStale(fetchedAt: string, nowMs: number): boolean {
  const fetchedMs = Date.parse(fetchedAt.includes("T") ? fetchedAt : `${fetchedAt}Z`);
  if (Number.isNaN(fetchedMs)) return true; // unparseable timestamp — treat as worth retrying
  return nowMs - fetchedMs >= NEGATIVE_CACHE_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * The logo for a ticker, downloading and caching it on first use.
 *
 * Order of preference:
 *  1. a cached image
 *  2. a cached "nothing found", if recent — returns undefined without a request
 *  3. otherwise ask the service, then store whichever outcome came back
 *
 * Returns undefined when there's no logo to show; the caller renders a fallback.
 * A network failure is reported as undefined too (and not cached), so a transient
 * outage doesn't get recorded as a permanent absence.
 */
export async function getOrFetchTickerLogo(
  repo: TickerLogoRepository,
  client: TickerLogoClient,
  rawTicker: string,
  nowMs: number = Date.now(),
): Promise<TickerLogoImage | undefined> {
  const ticker = normalizeTicker(rawTicker);
  if (!isValidTicker(ticker)) return undefined;

  const cached = repo.get(ticker);
  if (cached?.image && isAcceptableLogo(cached.image)) return cached.image;
  // A recent "nothing found" is honoured; an old one is worth another try.
  if (cached && !cached.image && !isStale(cached.fetchedAt, nowMs)) return undefined;

  let fetched;
  try {
    fetched = await client.fetch(ticker);
  } catch {
    // Transient failure: don't poison the cache with a negative entry.
    return undefined;
  }

  if (!fetched || !isAcceptableLogo(fetched.image)) {
    repo.saveMissing(ticker, fetched?.source ?? client.sourceFor(ticker));
    return undefined;
  }

  repo.save(ticker, fetched.image, fetched.source);
  return fetched.image;
}
