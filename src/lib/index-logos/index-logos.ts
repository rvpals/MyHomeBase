// Index logo lookup: serve from the cache, and only reach out to the icon
// service when there's nothing usable stored. Pure orchestration — the HTTP
// call is behind IndexIconClient and storage behind IndexLogoRepository.
//
// The same three-step shape as `getOrFetchTickerLogo`, with one difference that
// matters: the symbol is never interpolated into the outbound URL. It only
// selects a catalogue entry; the *domain* on that entry is what gets fetched.
// That is what makes an index symbol safe to handle without the strict ticker
// pattern — `^GSPC` and `DX-Y.NYB` never leave the process.

import type { IndexIconClient, IndexLogoRepository } from "./ports";
import type { IndexLogoImage } from "./types";

/**
 * What a stored image may be. SVG is excluded deliberately: it is a script
 * carrier and these bytes come from a third party. Matches the vendor-icon
 * allowlist, which fetches from the same service — favicons are commonly ICO,
 * which is why this list is wider than the ticker-logo one.
 */
export const INDEX_LOGO_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/x-icon",
  "image/vnd.microsoft.icon",
] as const;

/** A favicon renders at 20px here; 128 KB is already generous. */
export const MAX_INDEX_LOGO_BYTES = 128 * 1024;

/** A recorded "no logo" is retried after this long, rather than never. */
const NEGATIVE_CACHE_DAYS = 30;

/** True when a stored image is one we're willing to serve. */
export function isAcceptableIndexLogo(image: IndexLogoImage): boolean {
  return (
    (INDEX_LOGO_MIME_TYPES as readonly string[]).includes(image.mimeType) &&
    image.data.length > 0 &&
    image.data.length <= MAX_INDEX_LOGO_BYTES
  );
}

function isStale(fetchedAt: string, nowMs: number): boolean {
  const fetchedMs = Date.parse(fetchedAt.includes("T") ? fetchedAt : `${fetchedAt}Z`);
  if (Number.isNaN(fetchedMs)) return true; // unparseable timestamp — treat as worth retrying
  return nowMs - fetchedMs >= NEGATIVE_CACHE_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * The logo for one index, downloading and caching it on first use.
 *
 * Order of preference:
 *  1. a cached image
 *  2. a cached "nothing found", if recent — returns undefined without a request
 *  3. otherwise ask the service, then store whichever outcome came back
 *
 * Returns undefined when there's no logo to show; the caller renders a
 * fallback. A network failure is reported as undefined too (and not cached), so
 * a transient outage doesn't get recorded as a permanent absence.
 *
 * `domain` comes from the catalogue, not from the caller's URL — see the file
 * header. An index with no domain resolves to undefined without a request.
 */
export async function getOrFetchIndexLogo(
  repo: IndexLogoRepository,
  client: IndexIconClient,
  symbol: string,
  domain: string,
  nowMs: number = Date.now(),
): Promise<IndexLogoImage | undefined> {
  if (symbol.trim() === "" || domain.trim() === "") return undefined;

  const cached = repo.get(symbol);
  if (cached?.image && isAcceptableIndexLogo(cached.image)) return cached.image;
  // A recent "nothing found" is honoured; an old one is worth another try.
  if (cached && !cached.image && !isStale(cached.fetchedAt, nowMs)) return undefined;

  let fetched;
  try {
    fetched = await client.fetchForDomain(domain);
  } catch {
    // Transient failure: don't poison the cache with a negative entry.
    return undefined;
  }

  if (!fetched) {
    repo.saveMissing(symbol, domain);
    return undefined;
  }

  const image: IndexLogoImage = { data: fetched.data, mimeType: fetched.mimeType };
  if (!isAcceptableIndexLogo(image)) {
    repo.saveMissing(symbol, fetched.source);
    return undefined;
  }

  repo.save(symbol, image, fetched.source);
  return image;
}
