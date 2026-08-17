// Per-ticker sector lookup: serve from the cache, and only reach out to the
// provider when there's nothing stored or the stored answer has gone stale.
// Pure orchestration — the HTTP call sits behind TickerProfileClient and storage
// behind TickerProfileRepository.
//
// The distinction this file exists to draw: a provider that *answers* "this
// symbol has no sector" is telling us something worth keeping (it's every ETF),
// while a provider that *fails* is telling us nothing. Only the first is cached.

import type { TickerProfileClient, TickerProfileRepository } from "./ports";
import { NO_SECTOR_LABEL, type TickerProfileRecord } from "./types";

/**
 * Tickers are user-supplied and get interpolated into a third-party URL, so the
 * shape is enforced rather than trusted. Covers real symbols including dotted
 * classes (BRK.B) and hyphens. Same rule as the logo cache.
 */
const TICKER_PATTERN = /^[A-Z0-9.\-]{1,15}$/;

/**
 * A cached profile is re-checked after this long. Long, because a company's
 * sector changes approximately never — this exists so a blank row (an ETF, or a
 * symbol the provider didn't know yet) eventually gets another chance, not
 * because the data goes off.
 */
const CACHE_DAYS = 90;

export function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

export function isValidTicker(ticker: string): boolean {
  return TICKER_PATTERN.test(normalizeTicker(ticker));
}

export function isStale(fetchedAt: string, nowMs: number): boolean {
  // SQLite's datetime('now') has no zone marker; treat a bare timestamp as UTC.
  const fetchedMs = Date.parse(fetchedAt.includes("T") ? fetchedAt : `${fetchedAt}Z`);
  if (Number.isNaN(fetchedMs)) return true; // unparseable — worth another try
  return nowMs - fetchedMs >= CACHE_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * The sector to chart a ticker under: a hand-set override first, then the
 * provider's answer, then the fallback for anything with neither.
 *
 * Takes the record rather than the ticker so a roll-up over hundreds of
 * positions can resolve from one map instead of one query each.
 */
export function resolveSector(record: TickerProfileRecord | undefined): string {
  return record?.manualSector.trim() || record?.sector.trim() || NO_SECTOR_LABEL;
}

/**
 * Every cached profile keyed by ticker, ready for `resolveSector`.
 *
 * One read for the whole roll-up: the alternative is a query per position, and
 * the dashboard charts every holding at once.
 */
export function loadSectorMap(repo: TickerProfileRepository): Map<string, TickerProfileRecord> {
  return new Map(repo.list().map((record) => [record.ticker, record]));
}

/** True when a ticker has no usable cached answer and is worth fetching. */
export function needsFetch(
  record: TickerProfileRecord | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!record) return true;
  // A hand-set sector is the answer; the provider can't improve on it.
  if (record.manualSector.trim()) return false;
  return isStale(record.fetchedAt, nowMs);
}

/**
 * One ticker's profile, fetching and caching it when there's nothing usable.
 *
 * Returns undefined only for an invalid symbol or a failed request — and a
 * failure is deliberately *not* cached, so a transient outage doesn't get
 * recorded as "this symbol has no sector" for the next 90 days.
 */
export async function getOrFetchTickerProfile(
  repo: TickerProfileRepository,
  client: TickerProfileClient,
  rawTicker: string,
  nowMs: number = Date.now(),
): Promise<TickerProfileRecord | undefined> {
  const ticker = normalizeTicker(rawTicker);
  if (!isValidTicker(ticker)) return undefined;

  const cached = repo.get(ticker);
  if (!needsFetch(cached, nowMs)) return cached;

  try {
    const fetched = await client.fetch(ticker);
    // Blank fields are an answer ("no sector reported") and get stored as one.
    repo.save(ticker, fetched, client.source);
  } catch {
    // Transient failure: keep whatever we had rather than poisoning the cache.
    return cached;
  }

  return repo.get(ticker);
}

export interface RefreshProfilesResult {
  /** Tickers whose profile was fetched and stored on this run. */
  fetched: string[];
  /** Tickers skipped because a fresh answer was already cached. */
  skipped: string[];
  /** Tickers whose lookup failed. Nothing was cached for these. */
  failed: string[];
}

/**
 * Brings a set of tickers' profiles up to date, one at a time.
 *
 * Sequential rather than parallel on purpose: this runs inside Refresh All,
 * which is already walking the same symbols one by one against the same
 * unauthenticated provider. Firing forty concurrent requests at Yahoo is how a
 * free endpoint starts answering 429.
 *
 * Never throws — a symbol that can't be looked up lands in `failed` and the walk
 * carries on, because a missing sector must not fail a price refresh.
 */
export async function refreshTickerProfiles(
  repo: TickerProfileRepository,
  client: TickerProfileClient,
  tickers: string[],
  nowMs: number = Date.now(),
): Promise<RefreshProfilesResult> {
  const result: RefreshProfilesResult = { fetched: [], skipped: [], failed: [] };

  // De-duplicated: one ticker held in three accounts is still one lookup.
  const unique = [...new Set(tickers.map(normalizeTicker))].filter(isValidTicker);

  for (const ticker of unique) {
    if (!needsFetch(repo.get(ticker), nowMs)) {
      result.skipped.push(ticker);
      continue;
    }

    try {
      repo.save(ticker, await client.fetch(ticker), client.source);
      result.fetched.push(ticker);
    } catch {
      result.failed.push(ticker);
    }
  }

  return result;
}
