/**
 * Where a suggested ticker came from, in the order a reader would rank them:
 * something you hold outranks something you watch, which outranks a symbol we
 * only have reference data for.
 *
 * Carried on the suggestion so the picker can label it — "held" next to a
 * symbol is the difference between "this is your position" and "we've merely
 * seen this before".
 */
export type TickerSource = "position" | "watchlist" | "profile";

/** One ticker the system already knows about, ready to be matched and listed. */
export interface KnownTicker {
  ticker: string;
  source: TickerSource;
}

/** A match for what the reader typed. */
export interface TickerSuggestion extends KnownTicker {
  /**
   * True when the query matched at the start of the symbol rather than inside
   * it. Ranking uses it; the UI doesn't have to.
   */
  isPrefixMatch: boolean;
}
