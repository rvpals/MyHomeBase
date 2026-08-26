import { describe, expect, it } from "vitest";
import type { StockPosition } from "@/lib/stock-positions";
import { listFavoriteQuotes, summarizeFavoritePosition } from "./favorite-quotes";
import type { FavoritePositionReader, TickerFavoriteRepository } from "./ports";
import type { TickerFavorite } from "./types";

// Read-only fake: these tests never write, so unlike the fake in
// ticker-favorites.test.ts this one only has to honour "newest first".
function fakeRepo(tickers: string[] = []): TickerFavoriteRepository {
  const rows: TickerFavorite[] = tickers.map((ticker, index) => ({
    ticker,
    createdAt: `2026-08-19T00:00:${String(tickers.length - index).padStart(2, "0")}Z`,
  }));

  return {
    list: () => [...rows],
    isFavorite: (ticker) => rows.some((row) => row.ticker === ticker),
    add: () => undefined,
    remove: () => undefined,
  };
}

function position(overrides: Partial<StockPosition> = {}): StockPosition {
  return {
    accountId: 1,
    ticker: "AAPL",
    name: "Apple Inc.",
    type: "Stock",
    currentPriceCents: 20_000,
    quantity: 10,
    dayGainLossCents: 1_000,
    valueCents: 200_000,
    dayHighCents: 20_500,
    dayLowCents: 19_800,
    dividendRateCents: 100,
    costCents: 150_000,
    unitCostCents: 15_000,
    unrealizedGainLossCents: 50_000,
    unrealizedGainLossPct: 33.33,
    cusip: "",
    isin: "",
    assetClass: "Equity",
    assetStrategy: "",
    estAnnualIncomeCents: 1_000,
    incomeEarnedCents: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-08-20T09:41:00.000Z",
    ...overrides,
  };
}

function fakePositions(byTicker: Record<string, StockPosition[]>): FavoritePositionReader {
  return { listPositionsByTicker: (ticker) => byTicker[ticker] ?? [] };
}

describe("summarizeFavoritePosition", () => {
  it("carries the stored price and the day's move", () => {
    const result = summarizeFavoritePosition("AAPL", [position()]);

    expect(result.priceCents).toBe(20_000);
    expect(result.dayGainLossCents).toBe(1_000);
    // 1,000 gained on a 200,000 position: prior value 199,000.
    expect(result.dayChangePct).toBeCloseTo(0.5025, 3);
    expect(result.name).toBe("Apple Inc.");
    expect(result.updatedAt).toBe("2026-08-20T09:41:00.000Z");
  });

  it("reads the per-share price once but sums the day's move across accounts", () => {
    const result = summarizeFavoritePosition("AAPL", [
      position({ accountId: 1, dayGainLossCents: 1_000, valueCents: 200_000 }),
      position({ accountId: 2, dayGainLossCents: 500, valueCents: 100_000 }),
    ]);

    // Not doubled — the price is per share, identical on both rows.
    expect(result.priceCents).toBe(20_000);
    expect(result.dayGainLossCents).toBe(1_500);
  });

  it("reports the oldest refresh time, so freshness isn't overstated", () => {
    const result = summarizeFavoritePosition("AAPL", [
      position({ accountId: 1, updatedAt: "2026-08-20T09:41:00.000Z" }),
      position({ accountId: 2, updatedAt: "2026-08-18T16:00:00.000Z" }),
    ]);

    expect(result.updatedAt).toBe("2026-08-18T16:00:00.000Z");
  });

  it("reports a down day as a negative move", () => {
    const result = summarizeFavoritePosition("AAPL", [
      position({ dayGainLossCents: -2_000, valueCents: 198_000 }),
    ]);

    expect(result.dayGainLossCents).toBe(-2_000);
    expect(result.dayChangePct).toBeLessThan(0);
  });

  it("does not divide by zero when the whole value is the day's move", () => {
    const result = summarizeFavoritePosition("NEW", [
      position({ dayGainLossCents: 5_000, valueCents: 5_000 }),
    ]);

    expect(result.dayChangePct).toBe(0);
    expect(Number.isFinite(result.dayChangePct)).toBe(true);
  });

  // The case the whole optional-field design exists for.
  it("returns a bare row for a symbol that isn't held", () => {
    expect(summarizeFavoritePosition("ARKK", [])).toEqual({ ticker: "ARKK" });
  });
});

describe("listFavoriteQuotes", () => {
  it("prices held favorites and leaves unheld ones bare, newest first", () => {
    const repo = fakeRepo(["ARKK", "AAPL"]);
    const positions = fakePositions({ AAPL: [position()] });

    const result = listFavoriteQuotes(repo, positions);

    expect(result.map((row) => row.ticker)).toEqual(["ARKK", "AAPL"]);
    expect(result[0].priceCents).toBeUndefined();
    expect(result[1].priceCents).toBe(20_000);
  });

  it("is empty when nothing is starred, and asks positions for nothing", () => {
    let calls = 0;
    const positions: FavoritePositionReader = {
      listPositionsByTicker: () => {
        calls += 1;
        return [];
      },
    };

    expect(listFavoriteQuotes(fakeRepo(), positions)).toEqual([]);
    expect(calls).toBe(0);
  });
});
