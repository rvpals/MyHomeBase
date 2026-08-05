import type { MarketEvent, PricePoint, Quote } from "./types";

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
