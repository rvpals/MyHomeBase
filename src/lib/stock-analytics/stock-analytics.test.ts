import { describe, expect, it } from "vitest";
import type { MarketDataClient, PricePoint, Quote } from "@/lib/market-data";
import type { StockPosition } from "@/lib/stock-positions";
import type { StockAnalyticsRepository } from "./ports";
import { computeCorrelationMatrix, computeSharpe, computeVolatility } from "./stock-analytics";
import type { CorrelationResult, SharpeResult, VolatilityResult } from "./types";

function fakeRepo(): StockAnalyticsRepository & {
  savedCorrelation?: CorrelationResult;
  savedSharpe?: SharpeResult;
} {
  const repo: StockAnalyticsRepository & { savedCorrelation?: CorrelationResult; savedSharpe?: SharpeResult } = {
    listVolatilityCache: () => [],
    saveVolatilityCache: () => {},
    clearVolatilityCache: () => {},
    getCorrelationCache: () => repo.savedCorrelation,
    saveCorrelationCache: (result) => {
      repo.savedCorrelation = result;
    },
    clearCorrelationCache: () => {
      repo.savedCorrelation = undefined;
    },
    getSharpeCache: () => repo.savedSharpe,
    saveSharpeCache: (result) => {
      repo.savedSharpe = result;
    },
  };
  return repo;
}

// Deterministic daily-close series with a small oscillation so returns aren't all zero.
function makeSeries(days: number, basePriceCents: number, startTimestamp = 0): PricePoint[] {
  return Array.from({ length: days }, (_, i) => ({
    timestamp: startTimestamp + i * 86400,
    closeCents: basePriceCents + (i % 2 === 0 ? 50 : -30) * (i + 1),
  }));
}

function fakeMarketDataClient(
  historyByTicker: Record<string, PricePoint[] | Error>,
  quoteByTicker: Record<string, Quote> = {},
): MarketDataClient {
  return {
    async getQuote(ticker) {
      const quote = quoteByTicker[ticker];
      if (!quote) throw new Error(`No quote for ${ticker}.`);
      return quote;
    },
    async getHistory(ticker) {
      const history = historyByTicker[ticker];
      if (history === undefined) return [];
      if (history instanceof Error) throw history;
      return history;
    },
  };
}

function makePosition(overrides: Partial<StockPosition>): StockPosition {
  return {
    ticker: "AAPL",
    name: "Apple Inc.",
    type: "Stock",
    currentPriceCents: 15000,
    quantity: 10,
    dayGainLossCents: 0,
    valueCents: 150000,
    dayHighCents: 0,
    dayLowCents: 0,
    dividendRateCents: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("computeVolatility", () => {
  it("computes volatility stats and 52-week range from history", async () => {
    const history = makeSeries(60, 10000);
    const client = fakeMarketDataClient(
      { AAPL: history },
      { AAPL: { ticker: "AAPL", priceCents: 10500, previousCloseCents: 10400, shortName: "Apple Inc.", dayHighCents: 0, dayLowCents: 0, dividendRateCents: 0 } },
    );

    const result = await computeVolatility(client, makePosition({}));
    expect(result.ticker).toBe("AAPL");
    expect(result.sampleCount).toBe(60);
    expect(result.currentPriceCents).toBe(10500);
    expect(result.low52wCents).toBeLessThanOrEqual(result.high52wCents);
    expect(["Low", "Moderate", "High", "Very High"]).toContain(result.volatilityLabel);
  });

  it("returns zero volatility with no history", async () => {
    const client = fakeMarketDataClient(
      { AAPL: [] },
      { AAPL: { ticker: "AAPL", priceCents: 10500, previousCloseCents: 10400, dayHighCents: 0, dayLowCents: 0, dividendRateCents: 0 } },
    );
    const result = await computeVolatility(client, makePosition({}));
    expect(result.annualizedVolPct).toBe(0);
    expect(result.sampleCount).toBe(0);
  });
});

describe("computeCorrelationMatrix", () => {
  it("rejects fewer than 2 eligible positions", async () => {
    const repo = fakeRepo();
    const client = fakeMarketDataClient({});
    await expect(
      computeCorrelationMatrix(repo, client, [makePosition({ ticker: "AAPL" })]),
    ).rejects.toThrow("Need at least 2");
  });

  it("builds a symmetric matrix and caches the result, tolerating a failed ticker", async () => {
    const repo = fakeRepo();
    const client = fakeMarketDataClient({
      AAPL: makeSeries(30, 10000),
      SPY: makeSeries(30, 40000),
      MSFT: new Error("network down"),
    });
    const positions = [
      makePosition({ ticker: "AAPL" }),
      makePosition({ ticker: "SPY", type: "ETF" }),
      makePosition({ ticker: "MSFT" }),
    ];

    const result = await computeCorrelationMatrix(repo, client, positions);
    expect(result.tickers).toEqual(["AAPL", "SPY"]);
    expect(result.failedTickers).toEqual(["MSFT"]);
    expect(result.matrix).toHaveLength(2);
    expect(result.matrix[0][0]).toBe(1);
    expect(result.matrix[0][1]).toBe(result.matrix[1][0]);
    expect(repo.savedCorrelation).toEqual(result);
  });

  it("excludes positions with zero quantity or a non-Stock/ETF type", async () => {
    const repo = fakeRepo();
    const client = fakeMarketDataClient({ AAPL: makeSeries(30, 10000), SPY: makeSeries(30, 40000) });
    const positions = [
      makePosition({ ticker: "AAPL" }),
      makePosition({ ticker: "SPY", type: "ETF" }),
      makePosition({ ticker: "ZERO", quantity: 0 }),
      makePosition({ ticker: "BOND", type: "Bond" }),
    ];
    const result = await computeCorrelationMatrix(repo, client, positions);
    expect(result.tickers).toEqual(["AAPL", "SPY"]);
  });
});

describe("computeSharpe", () => {
  it("rejects when there are no eligible positions", async () => {
    const repo = fakeRepo();
    const client = fakeMarketDataClient({});
    await expect(computeSharpe(repo, client, [makePosition({ type: "Bond" })], {})).rejects.toThrow(
      "No Stock or ETF positions found.",
    );
  });

  it("reports insufficient data when two tickers barely overlap after alignment", async () => {
    // Each series individually clears the per-ticker minimum (>=31 rows), but
    // their date ranges only overlap by a handful of days once aligned.
    const repo = fakeRepo();
    const client = fakeMarketDataClient({
      AAPL: makeSeries(40, 10000, 0),
      SPY: makeSeries(40, 40000, 35 * 86400),
    });
    const positions = [makePosition({ ticker: "AAPL" }), makePosition({ ticker: "SPY", type: "ETF" })];
    const result = await computeSharpe(repo, client, positions, {});
    expect(result.sharpeRatio).toBeNull();
    expect(result.insufficientDataReason).toMatch(/aligned trading days/);
    expect(repo.savedSharpe).toEqual(result);
  });

  it("computes a Sharpe ratio and per-ticker breakdown with enough history", async () => {
    const repo = fakeRepo();
    const client = fakeMarketDataClient({
      AAPL: makeSeries(120, 10000),
      SPY: makeSeries(120, 40000),
    });
    const positions = [
      makePosition({ ticker: "AAPL", quantity: 10, currentPriceCents: 10000 }),
      makePosition({ ticker: "SPY", type: "ETF", quantity: 5, currentPriceCents: 40000 }),
    ];
    const result = await computeSharpe(repo, client, positions, { riskFreeRate: 0.05, lookbackDays: 365 });
    expect(result.alignedTradingDays).toBeGreaterThanOrEqual(30);
    expect(result.tickerDetails).toHaveLength(2);
    expect(result.tickerDetails.reduce((sum, detail) => sum + detail.weight, 0)).toBeCloseTo(1, 5);
    expect(repo.savedSharpe).toEqual(result);
  });

  it("skips a ticker with insufficient trading days but still computes from the rest", async () => {
    const repo = fakeRepo();
    const client = fakeMarketDataClient({
      AAPL: makeSeries(120, 10000),
      THIN: makeSeries(5, 5000),
    });
    const positions = [makePosition({ ticker: "AAPL" }), makePosition({ ticker: "THIN" })];
    const result = await computeSharpe(repo, client, positions, {});
    expect(result.skippedTickers).toEqual(["THIN"]);
    expect(result.skipReasons.THIN).toMatch(/trading days/);
  });
});
