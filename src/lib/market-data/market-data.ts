import type { MarketDataClient } from "./ports";
import { historyRequestSchema, tickerSchema } from "./schema";
import type { PricePoint, Quote } from "./types";

export async function lookupQuote(client: MarketDataClient, ticker: string): Promise<Quote> {
  const validated = tickerSchema.parse(ticker);
  return client.getQuote(validated);
}

export async function getPriceHistory(
  client: MarketDataClient,
  ticker: string,
  range: string,
  interval: string,
): Promise<PricePoint[]> {
  const validated = historyRequestSchema.parse({ ticker, range, interval });
  return client.getHistory(validated.ticker, validated.range, validated.interval);
}
