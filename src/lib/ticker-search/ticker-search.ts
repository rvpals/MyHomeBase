// Partial-match lookup over the tickers this system already knows about.
//
// Three sources feed it — positions, watch-list items and cached ticker
// profiles — and a symbol commonly appears in more than one. `collectKnownTickers`
// therefore dedupes, keeping the *strongest* source for each: a symbol you hold
// and also watch reads as held.
//
// Matching is substring, not prefix-only, because the reader may remember the
// middle of a symbol ("OGL" for GOOGL) — but a prefix hit is what they usually
// mean, so those sort first.

import type { KnownTicker, TickerSource, TickerSuggestion } from "./types";

/** How many suggestions a picker shows before it stops being scannable. */
export const DEFAULT_SUGGESTION_LIMIT = 8;

/** Lower number wins when the same symbol arrives from two sources. */
const SOURCE_RANK: Record<TickerSource, number> = {
  position: 0,
  watchlist: 1,
  profile: 2,
};

/** Upper-cased and trimmed — how every symbol in this app is stored. */
export function normalizeQuery(query: string): string {
  return query.trim().toUpperCase();
}

/**
 * Merges the three ticker sources into one deduped list, strongest source per
 * symbol, sorted alphabetically.
 *
 * Takes plain string arrays rather than the repository rows, so the caller
 * decides what a "held ticker" is and this stays independent of all three
 * modules' row shapes.
 */
export function collectKnownTickers(sources: {
  positionTickers: string[];
  watchListTickers: string[];
  profileTickers: string[];
}): KnownTicker[] {
  const strongest = new Map<string, TickerSource>();

  const consider = (ticker: string, source: TickerSource) => {
    const symbol = normalizeQuery(ticker);
    if (symbol === "") return;
    const existing = strongest.get(symbol);
    if (existing === undefined || SOURCE_RANK[source] < SOURCE_RANK[existing]) {
      strongest.set(symbol, source);
    }
  };

  for (const ticker of sources.positionTickers) consider(ticker, "position");
  for (const ticker of sources.watchListTickers) consider(ticker, "watchlist");
  for (const ticker of sources.profileTickers) consider(ticker, "profile");

  return [...strongest.entries()]
    .map(([ticker, source]) => ({ ticker, source }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
}

/**
 * The known tickers matching `query`, best first, capped at `limit`.
 *
 * A blank query returns the first `limit` known symbols rather than nothing:
 * opening the box and being shown what's there is more useful than an empty
 * panel that gives no hint the feature works.
 *
 * Ordering: prefix matches before substring matches, then by source strength
 * (held before watched before merely known), then alphabetically. The last tier
 * is what makes the result stable — without it two equally ranked symbols could
 * swap places between keystrokes.
 */
export function matchTickers(
  known: KnownTicker[],
  query: string,
  limit: number = DEFAULT_SUGGESTION_LIMIT,
): TickerSuggestion[] {
  const needle = normalizeQuery(query);

  const matches: TickerSuggestion[] = [];
  for (const entry of known) {
    if (needle === "") {
      matches.push({ ...entry, isPrefixMatch: false });
      continue;
    }
    const at = entry.ticker.indexOf(needle);
    if (at === -1) continue;
    matches.push({ ...entry, isPrefixMatch: at === 0 });
  }

  matches.sort((a, b) => {
    if (a.isPrefixMatch !== b.isPrefixMatch) return a.isPrefixMatch ? -1 : 1;
    if (a.source !== b.source) return SOURCE_RANK[a.source] - SOURCE_RANK[b.source];
    return a.ticker.localeCompare(b.ticker);
  });

  return matches.slice(0, Math.max(0, limit));
}

/**
 * Whether `query` names a ticker we already know about — an exact match, not a
 * partial one.
 *
 * The picker uses it to decide what pressing Enter on free text means: a known
 * symbol opens on the reader's own data, an unknown one has none to show and
 * opens on the provider's tab instead.
 */
export function isKnownTicker(known: KnownTicker[], query: string): boolean {
  const needle = normalizeQuery(query);
  return needle !== "" && known.some((entry) => entry.ticker === needle);
}
