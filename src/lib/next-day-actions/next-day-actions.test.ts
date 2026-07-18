import { describe, expect, it } from "vitest";
import type { MarketDataClient, PricePoint, Quote } from "@/lib/market-data";
import type { ModuleSetting } from "@/lib/module-settings";
import type { StockPositionRepository } from "@/lib/stock-positions";
import type { StockPosition, StockTransaction } from "@/lib/stock-positions";
import { resolveThresholds, runScan } from "./next-day-actions";

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

function makeTransaction(overrides: Partial<StockTransaction>): StockTransaction {
  return {
    id: 1,
    transactionAt: "2026-01-01",
    action: "Buy",
    ticker: "AAPL",
    numberOfShares: 10,
    pricePerShareCents: 14000,
    totalAmountCents: 140000,
    note: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function fakeRepo(positions: StockPosition[], transactionsByTicker: Record<string, StockTransaction[]> = {}): StockPositionRepository {
  return {
    listPositions: () => positions,
    getPositionByTicker: (ticker) => positions.find((p) => p.ticker === ticker),
    upsertPosition: () => {
      throw new Error("not used in this test");
    },
    deletePosition: () => {},
    listTransactions: (ticker) => (ticker ? transactionsByTicker[ticker] ?? [] : []),
    getTransactionById: () => undefined,
    createTransaction: () => {
      throw new Error("not used in this test");
    },
    updateTransaction: () => {
      throw new Error("not used in this test");
    },
    deleteTransaction: () => {},
    insertTransactionIfNotExists: () => {
      throw new Error("not used in this test");
    },
  };
}

function fakeMarketDataClient(historyByTicker: Record<string, PricePoint[] | Error>): MarketDataClient {
  return {
    async getQuote(): Promise<Quote> {
      throw new Error("not used in this test");
    },
    async getHistory(ticker) {
      const history = historyByTicker[ticker];
      if (history === undefined) return [];
      if (history instanceof Error) throw history;
      return history;
    },
  };
}

const thresholds = { profitTargetPct: 20, stockConcentrationCapPct: 10, etfConcentrationCapPct: 25 };

function flatHistory(days: number, closeCents: number, volume = 100): PricePoint[] {
  return Array.from({ length: days }, (_, i) => ({ timestamp: i * 86400, closeCents, volume }));
}

describe("runScan", () => {
  it("scans only positions with shares > 0 and sorts most-urgent action first", async () => {
    const positions = [
      makePosition({ ticker: "AAPL", quantity: 10, currentPriceCents: 15000, valueCents: 150000 }),
      makePosition({ ticker: "ZERO", quantity: 0, valueCents: 0 }),
      makePosition({ ticker: "SPY", type: "ETF", quantity: 5, currentPriceCents: 40000, valueCents: 200000 }),
    ];
    const client = fakeMarketDataClient({
      AAPL: flatHistory(20, 16000), // price 15000 < SMA 16000 -> StopLoss
      SPY: flatHistory(20, 30000), // price 40000 > SMA -> not stop loss; healthy -> Hold
    });

    const signals = await runScan(fakeRepo(positions), client, thresholds);

    expect(signals.map((s) => s.ticker)).toEqual(["AAPL", "SPY"]); // ZERO excluded
    expect(signals[0].action).toBe("StopLoss");
  });

  it("falls back gracefully when a ticker's market-data fetch fails", async () => {
    const positions = [makePosition({ ticker: "AAPL" })];
    const client = fakeMarketDataClient({ AAPL: new Error("network down") });

    const signals = await runScan(fakeRepo(positions), client, thresholds);
    expect(signals).toHaveLength(1);
    expect(signals[0].detailLog).toMatch(/Scan data unavailable/);
  });

  it("uses the share-weighted cost basis from Buy transactions for the return calc", async () => {
    const positions = [makePosition({ ticker: "AAPL", currentPriceCents: 15000, quantity: 10 })];
    const client = fakeMarketDataClient({ AAPL: flatHistory(20, 10000) });
    const transactions = { AAPL: [makeTransaction({ pricePerShareCents: 10000, numberOfShares: 10 })] };

    const signals = await runScan(fakeRepo(positions, transactions), client, thresholds);
    // (15000 - 10000) / 10000 * 100 = 50% -> exceeds 20% target
    expect(signals[0].totalReturnPct).toBeCloseTo(50, 5);
    expect(signals[0].action).toBe("TrimProfit");
  });

  it("falls back to current price as cost basis when there are no Buy transactions", async () => {
    const positions = [makePosition({ ticker: "AAPL", currentPriceCents: 15000 })];
    const client = fakeMarketDataClient({ AAPL: flatHistory(20, 10000) });

    const signals = await runScan(fakeRepo(positions), client, thresholds);
    expect(signals[0].totalReturnPct).toBe(0);
  });
});

describe("resolveThresholds", () => {
  it("reads configured percentages from module settings", () => {
    const settings: ModuleSetting[] = [
      { id: 1, moduleId: 3, key: "profit_target_pct", value: "15" },
      { id: 2, moduleId: 3, key: "stock_concentration_cap", value: "8" },
      { id: 3, moduleId: 3, key: "etf_concentration_cap", value: "30" },
    ];
    expect(resolveThresholds(settings)).toEqual({
      profitTargetPct: 15,
      stockConcentrationCapPct: 8,
      etfConcentrationCapPct: 30,
    });
  });

  it("falls back to defaults when settings are missing or non-numeric", () => {
    expect(resolveThresholds([])).toEqual({
      profitTargetPct: 20,
      stockConcentrationCapPct: 10,
      etfConcentrationCapPct: 25,
    });
    expect(resolveThresholds([{ id: 1, moduleId: 3, key: "profit_target_pct", value: "not-a-number" }])).toEqual({
      profitTargetPct: 20,
      stockConcentrationCapPct: 10,
      etfConcentrationCapPct: 25,
    });
  });
});
