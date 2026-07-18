import type { PricePoint, Quote } from "./types";

export interface MarketDataClient {
  getQuote(ticker: string): Promise<Quote>;
  getHistory(ticker: string, range: string, interval: string): Promise<PricePoint[]>;
}
