import type { MarketEvent, PricePoint, Quote, RawQuoteSummary } from "./types";

export interface MarketDataClient {
  getQuote(ticker: string): Promise<Quote>;
  getHistory(ticker: string, range: string, interval: string): Promise<PricePoint[]>;
}

/**
 * Dividends, splits and reported quarters for a symbol.
 *
 * A second port rather than a third method on `MarketDataClient`: prices and
 * events are fetched independently, almost every caller wants only prices, and
 * folding it in would make every existing fake implement a method it never
 * calls. `YahooFinanceClient` implements both.
 */
export interface MarketEventsClient {
  /**
   * Events falling inside `range`, oldest first. Returns an empty list rather
   * than throwing when the provider has none — plenty of symbols pay nothing
   * and never split, and that's an answer, not a failure.
   */
  getEvents(ticker: string, range: string): Promise<MarketEvent[]>;
}

/**
 * The provider's whole reference record for a symbol, unnormalised.
 *
 * A third port for the same reason the second exists: this is one expensive
 * authenticated call that most callers never make, and folding it into
 * `MarketDataClient` would make every fake implement it. Normalising the
 * payload is `src/lib/ticker-detail`'s job, not the adapter's — the adapter
 * fetches, the use-case interprets.
 */
export interface QuoteSummaryClient {
  /**
   * Throws when the provider can't be reached or returns nothing. Individual
   * modules being absent is normal (an ETF has no income statement) and is
   * reported as missing sections, not as a failure.
   */
  getQuoteSummary(ticker: string): Promise<RawQuoteSummary>;
}
