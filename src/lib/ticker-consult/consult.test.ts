import { describe, expect, it } from "vitest";
import type { TickerOwnData, TickerQuote } from "@/lib/ticker-overview";
import type { TickerTradeRow } from "@/lib/ticker-overview";
import { buildTickerConsult, buildTickerConsultInput, consultFileName, priceBand } from "./consult";
import { tickerConsultOptionsSchema } from "./schema";

const NOW = new Date("2026-09-14T18:30:00.000Z");

function trade(overrides: Partial<TickerTradeRow> = {}): TickerTradeRow {
  return {
    id: 1,
    transactionAt: "2026-03-10T00:00:00.000Z",
    action: "Buy",
    ticker: "AAPL",
    numberOfShares: 10,
    pricePerShareCents: 18_000,
    totalAmountCents: 180_000,
    accountId: 1,
    brokerageFirm: "Chase",
    externalId: "",
    note: "",
    createdAt: "2026-03-10T00:00:00.000Z",
    updatedAt: "2026-03-10T00:00:00.000Z",
    hasMoveSince: true,
    moveSinceCentsPerShare: 2_000,
    moveSinceCents: 20_000,
    moveSincePct: 11.11,
    ...overrides,
  };
}

function ownData(overrides: Partial<TickerOwnData> = {}): TickerOwnData {
  return {
    ticker: "AAPL",
    name: "Apple Inc.",
    type: "Stock",
    isHeld: true,
    isWatched: false,
    holdings: [
      {
        accountId: 1,
        accountName: "Taxable",
        quantity: 10,
        currentPriceCents: 20_000,
        costCents: 180_000,
        unitCostCents: 18_000,
        valueCents: 200_000,
        dayGainLossCents: 1_000,
        unrealizedGainLossCents: 20_000,
        unrealizedGainLossPct: 11.11,
      },
    ],
    totals: {
      accountCount: 1,
      quantity: 10,
      costCents: 180_000,
      valueCents: 200_000,
      dayGainLossCents: 1_000,
      dayChangePct: 0.5,
      unrealizedGainLossCents: 20_000,
      totalReturnPct: 11.11,
      averageUnitCostCents: 18_000,
    },
    income: {
      dividendRateCents: 100,
      estAnnualIncomeCents: 1_000,
      incomeEarnedCents: 500,
      yieldOnValuePct: 0.5,
      yieldOnCostPct: 0.56,
    },
    trades: {
      transactions: [trade()],
      currentPriceCents: 20_000,
      stats: {
        count: 1,
        avgPricePerShareCents: 18_000,
        maxPricePerShareCents: 18_000,
        minPricePerShareCents: 18_000,
      },
      averageCostBasisCents: 18_000,
      buyCount: 1,
      sellCount: 0,
      sharesBought: 10,
      sharesSold: 0,
      totalBoughtCents: 180_000,
      totalSoldCents: 0,
      firstTradeAt: "2026-03-10T00:00:00.000Z",
      lastTradeAt: "2026-03-10T00:00:00.000Z",
    },
    watchEntries: [],
    portfolioWeight: {
      valueCents: 200_000,
      portfolioValueCents: 2_000_000,
      weightPct: 10,
      rank: 3,
      holdingCount: 20,
      largestWeightPct: 18,
      evenWeightPct: 5,
      byAccount: [],
    },
    assetClass: "Equity",
    assetStrategy: "Growth",
    cusip: "037833100",
    isin: "US0378331005",
    lastUpdatedAt: "2026-09-13T21:00:00.000Z",
    ...overrides,
  };
}

function quote(overrides: Partial<TickerQuote> = {}): TickerQuote {
  return {
    ticker: "AAPL",
    shortName: "Apple Inc.",
    priceCents: 20_000,
    previousCloseCents: 19_800,
    changeCents: 200,
    changePct: 1.01,
    dayHighCents: 20_100,
    dayLowCents: 19_750,
    dividendRateCents: 100,
    fetchedAt: "2026-09-14T18:00:00.000Z",
    ...overrides,
  };
}

describe("priceBand", () => {
  it("brackets the price by the tolerance, in whole cents", () => {
    expect(priceBand(20_000, 15)).toEqual({
      tolerancePct: 15,
      lowCents: 17_000,
      highCents: 23_000,
    });
  });

  it("rounds a band that does not land on a whole cent", () => {
    expect(priceBand(3_333, 15)).toEqual({
      tolerancePct: 15,
      lowCents: 2_833,
      highCents: 3_833,
    });
  });

  it("never returns a negative floor, even for an absurd tolerance", () => {
    expect(priceBand(1_000, 150).lowCents).toBe(0);
  });

  it("returns a zero-width band for a price of zero", () => {
    expect(priceBand(0, 15)).toEqual({ tolerancePct: 15, lowCents: 0, highCents: 0 });
  });
});

describe("buildTickerConsultInput", () => {
  it("prefers the live quote and calls a moved price intraday", () => {
    const input = buildTickerConsultInput({ ticker: "AAPL", ownData: ownData(), quote: quote() });

    expect(input.referencePrice).toEqual({
      cents: 20_000,
      source: "intraday",
      asOf: "2026-09-14T18:00:00.000Z",
    });
    expect(input.band).toEqual({ tolerancePct: 15, lowCents: 17_000, highCents: 23_000 });
  });

  it("calls a quote that has not moved off its previous close a settled close", () => {
    const input = buildTickerConsultInput({
      ticker: "AAPL",
      ownData: ownData(),
      quote: quote({ priceCents: 19_800, changeCents: 0, changePct: 0 }),
    });

    expect(input.referencePrice.source).toBe("close");
    expect(input.referencePrice.cents).toBe(19_800);
  });

  it("falls back to our own recorded price when no quote is loaded, and labels it as such", () => {
    const input = buildTickerConsultInput({ ticker: "AAPL", ownData: ownData(), now: NOW });

    expect(input.referencePrice).toEqual({
      cents: 20_000,
      source: "recorded",
      asOf: "2026-09-13T21:00:00.000Z",
    });
  });

  it("reports no cost basis rather than a zero one", () => {
    const base = ownData();
    const input = buildTickerConsultInput({
      ticker: "AAPL",
      ownData: {
        ...base,
        totals: { ...base.totals, costCents: 0, averageUnitCostCents: 0, totalReturnPct: 0 },
      },
    });

    expect(input.position.hasCostBasis).toBe(false);
  });

  it("orders the trades oldest first and dates them to the local calendar", () => {
    const base = ownData();
    const input = buildTickerConsultInput({
      ticker: "AAPL",
      ownData: {
        ...base,
        trades: {
          ...base.trades,
          // Newest first, the way the viewer's table carries them.
          transactions: [
            trade({ id: 2, transactionAt: "2026-06-01T00:00:00.000Z", action: "Sell" }),
            trade({ id: 1, transactionAt: "2026-03-10T00:00:00.000Z" }),
          ],
        },
      },
    });

    expect(input.history.trades.map((row) => row.date)).toEqual(["2026-03-10", "2026-06-01"]);
    expect(input.history.trades[1].action).toBe("Sell");
  });

  it("dates a midnight-UTC trade to the day it is stored under, in any timezone", () => {
    // Regression: parsing the instant and reading a local calendar off it moved
    // a trade stored as midnight UTC to the previous day west of Greenwich, so a
    // purchase was reported on a date it did not happen on. The stored
    // YYYY-MM-DD is taken literally instead.
    const base = ownData();
    const input = buildTickerConsultInput({
      ticker: "AAPL",
      ownData: {
        ...base,
        trades: {
          ...base.trades,
          transactions: [trade({ transactionAt: "2026-03-10T00:00:00.000Z" })],
          firstTradeAt: "2026-03-10T00:00:00.000Z",
          lastTradeAt: "2026-03-10T00:00:00.000Z",
        },
      },
    });

    expect(input.history.trades[0].date).toBe("2026-03-10");
    expect(input.history.firstTradeDate).toBe("2026-03-10");
    expect(input.history.lastTradeDate).toBe("2026-03-10");
  });

  it("carries a watch-only symbol through with no shares and no basis", () => {
    const input = buildTickerConsultInput({
      ticker: "NVDA",
      ownData: ownData({
        ticker: "NVDA",
        name: "",
        isHeld: false,
        isWatched: true,
        holdings: [],
        totals: {
          accountCount: 0,
          quantity: 0,
          costCents: 0,
          valueCents: 0,
          dayGainLossCents: 0,
          dayChangePct: 0,
          unrealizedGainLossCents: 0,
          totalReturnPct: 0,
          averageUnitCostCents: 0,
        },
        lastUpdatedAt: undefined,
      }),
      quote: quote({ ticker: "NVDA", shortName: "NVIDIA Corp" }),
    });

    expect(input.position.isHeld).toBe(false);
    expect(input.position.quantity).toBe(0);
    expect(input.position.hasCostBasis).toBe(false);
    // The provider's short name is the fallback when our own records have none.
    expect(input.name).toBe("NVIDIA Corp");
  });

  it("reports a zero reference price when neither a quote nor a recorded price exists", () => {
    const base = ownData();
    const input = buildTickerConsultInput({
      ticker: "AAPL",
      ownData: {
        ...base,
        holdings: [],
        trades: { ...base.trades, currentPriceCents: 0 },
      },
      now: NOW,
    });

    expect(input.referencePrice.cents).toBe(0);
    expect(input.band).toEqual({ tolerancePct: 15, lowCents: 0, highCents: 0 });
  });

  it("passes the sector and industry through when the caller loaded them", () => {
    const input = buildTickerConsultInput({
      ticker: "AAPL",
      ownData: ownData(),
      sector: "Technology",
      industry: "Consumer Electronics",
    });

    expect(input.sector).toBe("Technology");
    expect(input.industry).toBe("Consumer Electronics");
  });

  it("honours a caller-supplied tolerance", () => {
    const input = buildTickerConsultInput({
      ticker: "AAPL",
      ownData: ownData(),
      quote: quote(),
      tolerancePct: 10,
    });

    expect(input.band).toEqual({ tolerancePct: 10, lowCents: 18_000, highCents: 22_000 });
  });
});

describe("consultFileName", () => {
  it("names the file for the ticker and the day", () => {
    expect(consultFileName("aapl", NOW)).toMatch(/^AAPL-ai-consult-\d{4}-\d{2}-\d{2}\.md$/);
  });
});

describe("buildTickerConsult", () => {
  it("returns the prompt and a matching file name", () => {
    const result = buildTickerConsult({
      ticker: "AAPL",
      ownData: ownData(),
      quote: quote(),
      sector: "Technology",
      now: NOW,
    });

    expect(result.ticker).toBe("AAPL");
    expect(result.fileName).toMatch(/^AAPL-ai-consult-/);
    expect(result.content).toContain("AAPL");
    expect(result.content.length).toBeGreaterThan(100);
  });

  it("is deterministic for the same records", () => {
    const options = {
      ticker: "AAPL",
      ownData: ownData(),
      quote: quote(),
      sector: "Technology",
      now: NOW,
    };

    expect(buildTickerConsult(options).content).toBe(buildTickerConsult(options).content);
  });
});

describe("tickerConsultOptionsSchema", () => {
  it("upper-cases the ticker and defaults the band to 15%", () => {
    expect(tickerConsultOptionsSchema.parse({ ticker: " aapl " })).toEqual({
      ticker: "AAPL",
      tolerancePct: 15,
    });
  });

  it("rejects an empty ticker", () => {
    expect(() => tickerConsultOptionsSchema.parse({ ticker: "  " })).toThrow();
  });

  it("rejects a band of zero or one wide enough to be meaningless", () => {
    expect(() => tickerConsultOptionsSchema.parse({ ticker: "AAPL", tolerancePct: 0 })).toThrow();
    expect(() => tickerConsultOptionsSchema.parse({ ticker: "AAPL", tolerancePct: 80 })).toThrow();
  });
});
