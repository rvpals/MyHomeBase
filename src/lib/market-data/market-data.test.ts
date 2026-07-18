import { describe, expect, it } from "vitest";
import { getPriceHistory, lookupQuote } from "./market-data";
import type { MarketDataClient } from "./ports";
import type { PricePoint, Quote } from "./types";

// Hand-written fake — no mocking framework, no real network calls.
function fakeClient(quote: Quote, history: PricePoint[] = []): MarketDataClient {
  return {
    async getQuote(ticker) {
      if (ticker !== quote.ticker) throw new Error(`No quote for ${ticker}.`);
      return quote;
    },
    async getHistory() {
      return history;
    },
  };
}

const sampleQuote: Quote = {
  ticker: "AAPL",
  priceCents: 15000,
  previousCloseCents: 14900,
  shortName: "Apple Inc.",
  dayHighCents: 15200,
  dayLowCents: 14800,
  dividendRateCents: 96,
};

describe("lookupQuote", () => {
  it("returns the client's quote for a valid ticker", async () => {
    const client = fakeClient(sampleQuote);
    await expect(lookupQuote(client, "AAPL")).resolves.toEqual(sampleQuote);
  });

  it("rejects an empty ticker before calling the client", async () => {
    const client = fakeClient(sampleQuote);
    await expect(lookupQuote(client, "")).rejects.toThrow();
  });

  it("propagates the client's error for an unknown ticker", async () => {
    const client = fakeClient(sampleQuote);
    await expect(lookupQuote(client, "MSFT")).rejects.toThrow("No quote for MSFT.");
  });
});

describe("getPriceHistory", () => {
  const history: PricePoint[] = [
    { timestamp: 1, closeCents: 15000 },
    { timestamp: 2, closeCents: 15100 },
  ];

  it("returns the client's history for valid inputs", async () => {
    const client = fakeClient(sampleQuote, history);
    await expect(getPriceHistory(client, "AAPL", "1y", "1d")).resolves.toEqual(history);
  });

  it("rejects an empty range", async () => {
    const client = fakeClient(sampleQuote, history);
    await expect(getPriceHistory(client, "AAPL", "", "1d")).rejects.toThrow();
  });
});
