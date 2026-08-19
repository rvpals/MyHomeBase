import { describe, expect, it } from "vitest";
import type { InvestmentAccount, InvestmentAccountRepository } from "@/lib/investment-accounts";
import type {
  MarketDataClient,
  MarketEvent,
  MarketEventsClient,
  PricePoint,
  Quote,
} from "@/lib/market-data";
import type {
  StockPosition,
  StockPositionRepository,
  StockTransaction,
} from "@/lib/stock-positions";
import type { RawNewsStory, TickerNewsClient } from "@/lib/ticker-news";
import type {
  StockWatchList,
  StockWatchListItem,
  StockWatchListRepository,
} from "@/lib/stock-watchlist";
import type { TickerOwnDataDeps } from "./ports";
import {
  buildTickerEvents,
  buildTradeTimeline,
  computeWatchDrift,
  getTickerEvents,
  getTickerNewsFeed,
  getTickerOwnData,
  getTickerPriceSeries,
  getTickerQuote,
  getTickerRisk,
  getTickerTradeTimeline,
  historyRangeCovering,
  rankStories,
  summarizeHoldings,
  summarizeIncome,
  summarizePriceSeries,
  computeTradeMoveSince,
  summarizeTrades,
  transactionDate,
} from "./ticker-overview";
import type { TickerClosePoint, TickerHolding, TickerRisk } from "./types";

const TIMESTAMPS = "2026-01-01T00:00:00.000Z";

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
    cusip: "037833100",
    isin: "US0378331005",
    assetClass: "Equity",
    assetStrategy: "US Large Cap",
    estAnnualIncomeCents: 1_000,
    incomeEarnedCents: 400,
    createdAt: TIMESTAMPS,
    updatedAt: TIMESTAMPS,
    ...overrides,
  };
}

function transaction(overrides: Partial<StockTransaction> = {}): StockTransaction {
  return {
    id: 1,
    transactionAt: "2025-06-01",
    action: "Buy",
    ticker: "AAPL",
    numberOfShares: 10,
    pricePerShareCents: 15_000,
    totalAmountCents: 150_000,
    brokerageFirm: "Chase",
    externalId: "",
    note: "",
    createdAt: TIMESTAMPS,
    updatedAt: TIMESTAMPS,
    ...overrides,
  };
}

function holding(overrides: Partial<TickerHolding> = {}): TickerHolding {
  return {
    accountId: 1,
    accountName: "Fidelity",
    quantity: 10,
    currentPriceCents: 20_000,
    costCents: 150_000,
    unitCostCents: 15_000,
    valueCents: 200_000,
    dayGainLossCents: 1_000,
    unrealizedGainLossCents: 50_000,
    unrealizedGainLossPct: 33.33,
    ...overrides,
  };
}

/** Hand-written fakes — an in-memory object per port, no mocking framework. */
function fakeDeps({
  positions = [] as StockPosition[],
  transactions = [] as StockTransaction[],
  accounts = [] as InvestmentAccount[],
  lists = [] as StockWatchList[],
  items = [] as StockWatchListItem[],
} = {}): TickerOwnDataDeps {
  const positionRepo = {
    listPositionsByTicker: (ticker: string) =>
      positions.filter((row) => row.ticker.toUpperCase() === ticker.toUpperCase()),
    listTransactions: (ticker?: string) =>
      ticker
        ? transactions.filter((row) => row.ticker.toUpperCase() === ticker.toUpperCase())
        : [...transactions],
  } as unknown as StockPositionRepository;

  const accountRepo = {
    listAccounts: () => [...accounts],
  } as unknown as InvestmentAccountRepository;

  const watchListRepo = {
    listWatchLists: () => [...lists],
    listItems: (watchListId: number) => items.filter((item) => item.watchListId === watchListId),
  } as unknown as StockWatchListRepository;

  return { positions: positionRepo, accounts: accountRepo, watchLists: watchListRepo };
}

function fakeMarketClient(
  historyByTicker: Record<string, PricePoint[]>,
  quote?: Partial<Quote>,
): MarketDataClient {
  return {
    async getQuote(ticker) {
      return {
        ticker,
        priceCents: 20_000,
        previousCloseCents: 19_000,
        shortName: "Apple Inc.",
        dayHighCents: 20_500,
        dayLowCents: 19_800,
        dividendRateCents: 100,
        ...quote,
      };
    },
    async getHistory(ticker) {
      const history = historyByTicker[ticker];
      if (!history) throw new Error(`No history for ${ticker}`);
      return history;
    },
  };
}

/** A synthetic daily series, one point per day, walking by `step` cents. */
function series(startCents: number, step: number, days: number): PricePoint[] {
  return Array.from({ length: days }, (_, index) => ({
    // 86_400 seconds per day, from a fixed epoch so both legs align.
    timestamp: 1_700_000_000 + index * 86_400,
    closeCents: startCents + index * step,
    volume: 1_000 + index,
  }));
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("summarizeHoldings", () => {
  it("sums across accounts and derives the day and total return percentages", () => {
    const totals = summarizeHoldings([
      holding({ accountId: 1, quantity: 10, costCents: 150_000, valueCents: 200_000 }),
      holding({
        accountId: 2,
        quantity: 5,
        costCents: 50_000,
        valueCents: 100_000,
        dayGainLossCents: 1_000,
        unrealizedGainLossCents: 50_000,
      }),
    ]);

    expect(totals.accountCount).toBe(2);
    expect(totals.quantity).toBe(15);
    expect(totals.costCents).toBe(200_000);
    expect(totals.valueCents).toBe(300_000);
    expect(totals.dayGainLossCents).toBe(2_000);
    // 2_000 against the 298_000 it was worth before moving.
    expect(totals.dayChangePct).toBeCloseTo((2_000 / 298_000) * 100, 6);
    expect(totals.unrealizedGainLossCents).toBe(100_000);
    expect(totals.totalReturnPct).toBeCloseTo(50, 6);
    expect(totals.averageUnitCostCents).toBe(Math.round(200_000 / 15));
  });

  it("returns zeroes rather than dividing by zero for an empty or basis-less holding", () => {
    expect(summarizeHoldings([])).toMatchObject({
      accountCount: 0,
      quantity: 0,
      dayChangePct: 0,
      totalReturnPct: 0,
      averageUnitCostCents: 0,
    });

    const noBasis = summarizeHoldings([holding({ costCents: 0, unrealizedGainLossCents: 0 })]);
    expect(noBasis.totalReturnPct).toBe(0);
    expect(noBasis.averageUnitCostCents).toBe(0);
  });
});

describe("summarizeIncome", () => {
  it("reads the per-share rate once but sums the per-account amounts", () => {
    const income = summarizeIncome(
      [
        { dividendRateCents: 100, estAnnualIncomeCents: 1_000, incomeEarnedCents: 400 },
        { dividendRateCents: 100, estAnnualIncomeCents: 500, incomeEarnedCents: 100 },
      ],
      300_000,
      200_000,
    );

    expect(income.dividendRateCents).toBe(100);
    expect(income.estAnnualIncomeCents).toBe(1_500);
    expect(income.incomeEarnedCents).toBe(500);
    expect(income.yieldOnValuePct).toBeCloseTo(0.5, 6);
    expect(income.yieldOnCostPct).toBeCloseTo(0.75, 6);
  });

  it("reports zero yields when there is no value or basis to divide by", () => {
    const income = summarizeIncome(
      [{ dividendRateCents: 0, estAnnualIncomeCents: 0, incomeEarnedCents: 0 }],
      0,
      0,
    );
    expect(income.yieldOnValuePct).toBe(0);
    expect(income.yieldOnCostPct).toBe(0);
  });
});

describe("summarizeTrades", () => {
  it("orders newest first and splits the buy and sell totals", () => {
    const trades = summarizeTrades([
      transaction({ id: 1, transactionAt: "2025-01-10", action: "Buy", numberOfShares: 10 }),
      transaction({
        id: 2,
        transactionAt: "2025-08-20",
        action: "Sell",
        numberOfShares: 4,
        pricePerShareCents: 21_000,
        totalAmountCents: 84_000,
      }),
    ]);

    expect(trades.transactions.map((row) => row.id)).toEqual([2, 1]);
    expect(trades.buyCount).toBe(1);
    expect(trades.sellCount).toBe(1);
    expect(trades.sharesBought).toBe(10);
    expect(trades.sharesSold).toBe(4);
    expect(trades.totalBoughtCents).toBe(150_000);
    expect(trades.totalSoldCents).toBe(84_000);
    expect(trades.firstTradeAt).toBe("2025-01-10");
    expect(trades.lastTradeAt).toBe("2025-08-20");
    // The average basis is the buy legs only — the sell must not drag it up.
    expect(trades.averageCostBasisCents).toBe(15_000);
  });

  it("has no basis and no trade dates when nothing was recorded", () => {
    const trades = summarizeTrades([]);
    expect(trades.transactions).toEqual([]);
    expect(trades.averageCostBasisCents).toBeUndefined();
    expect(trades.firstTradeAt).toBeUndefined();
    expect(trades.lastTradeAt).toBeUndefined();
    expect(trades.stats.count).toBe(0);
  });
});

describe("computeTradeMoveSince", () => {
  it("measures the move against the price paid, per share and across the trade", () => {
    expect(computeTradeMoveSince(10_000, 4, 12_500)).toEqual({
      hasMoveSince: true,
      moveSinceCentsPerShare: 2_500,
      moveSinceCents: 10_000,
      moveSincePct: 25,
    });
  });

  it("carries the sign through on a trade that is now under water", () => {
    expect(computeTradeMoveSince(20_000, 3, 15_000)).toEqual({
      hasMoveSince: true,
      moveSinceCentsPerShare: -5_000,
      moveSinceCents: -15_000,
      moveSincePct: -25,
    });
  });

  it("reports no move when either price is missing, rather than a total loss", () => {
    expect(computeTradeMoveSince(0, 4, 12_500).hasMoveSince).toBe(false);
    expect(computeTradeMoveSince(10_000, 4, 0)).toEqual({
      hasMoveSince: false,
      moveSinceCentsPerShare: 0,
      moveSinceCents: 0,
      moveSincePct: 0,
    });
  });

  it("rounds a fractional-share move to whole cents", () => {
    expect(computeTradeMoveSince(10_000, 1.5, 10_001).moveSinceCents).toBe(2);
  });
});

describe("summarizeTrades", () => {
  it("decorates every row with the move since that trade", () => {
    const trades = summarizeTrades(
      [
        transaction({ id: 1, pricePerShareCents: 10_000, numberOfShares: 10 }),
        transaction({
          id: 2,
          transactionAt: "2025-08-20",
          pricePerShareCents: 20_000,
          numberOfShares: 5,
        }),
      ],
      12_500,
    );

    expect(trades.currentPriceCents).toBe(12_500);
    expect(
      trades.transactions.map((row) => [row.id, row.moveSinceCents, row.moveSincePct]),
    ).toEqual([
      [2, -37_500, -37.5],
      [1, 25_000, 25],
    ]);
  });

  it("reports no move on any row when the ticker is not held", () => {
    const trades = summarizeTrades([transaction({ id: 1 })]);
    expect(trades.currentPriceCents).toBe(0);
    expect(trades.transactions[0].hasMoveSince).toBe(false);
    expect(trades.transactions[0].moveSincePct).toBe(0);
  });
});

describe("computeWatchDrift", () => {
  it("measures the move against the price when it was added", () => {
    expect(computeWatchDrift(10_000, 12_500)).toEqual({
      changeSinceAddedCents: 2_500,
      changeSinceAddedPct: 25,
    });
  });

  it("reports no drift when either price is missing, rather than a 100% collapse", () => {
    expect(computeWatchDrift(0, 12_500)).toEqual({
      changeSinceAddedCents: 0,
      changeSinceAddedPct: 0,
    });
    expect(computeWatchDrift(10_000, 0)).toEqual({
      changeSinceAddedCents: 0,
      changeSinceAddedPct: 0,
    });
  });
});

describe("summarizePriceSeries", () => {
  it("sorts oldest first and captions the window", () => {
    const result = summarizePriceSeries("AAPL", "1mo", [
      { timestamp: 1_700_086_400, closeCents: 12_000, volume: 200 },
      { timestamp: 1_700_000_000, closeCents: 10_000, volume: 100 },
    ]);

    expect(result.points.map((point) => point.closeCents)).toEqual([10_000, 12_000]);
    expect(result.startCloseCents).toBe(10_000);
    expect(result.endCloseCents).toBe(12_000);
    expect(result.changeCents).toBe(2_000);
    expect(result.changePct).toBeCloseTo(20, 6);
    expect(result.highCents).toBe(12_000);
    expect(result.lowCents).toBe(10_000);
    expect(result.averageVolume).toBe(150);
  });

  it("drops non-positive closes and zeroes the summary when nothing is left", () => {
    const result = summarizePriceSeries("AAPL", "1y", [{ timestamp: 1_700_000_000, closeCents: 0 }]);
    expect(result.points).toEqual([]);
    expect(result.changePct).toBe(0);
    expect(result.highCents).toBe(0);
    expect(result.averageVolume).toBeUndefined();
  });
});

describe("rankStories", () => {
  const stories: RawNewsStory[] = [
    {
      title: "Markets drift lower",
      publisher: "Reuters",
      url: "https://example.com/a",
      publishedAt: "2026-08-05T12:00:00.000Z",
      relatedTickers: ["SPY", "AAPL"],
    },
    {
      title: "AAPL beats on services revenue",
      publisher: "Bloomberg",
      url: "https://example.com/b",
      publishedAt: "2026-08-04T12:00:00.000Z",
      relatedTickers: ["AAPL"],
    },
  ];

  it("puts stories the ticker leads above ones that merely mention it", () => {
    const ranked = rankStories(stories, "AAPL", "2026-08-05");
    expect(ranked[0].title).toBe("AAPL beats on services revenue");
    expect(ranked[0].isPrimarySubject).toBe(true);
    expect(ranked[1].isPrimarySubject).toBe(false);
  });

  it("flags which stories ran today and drops unusable ones", () => {
    const ranked = rankStories(
      [...stories, { title: "  ", publisher: "X", url: "", publishedAt: "", relatedTickers: [] }],
      "AAPL",
      "2026-08-05",
    );
    expect(ranked).toHaveLength(2);
    expect(ranked.some((story) => story.isFromToday)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Use-cases
// ---------------------------------------------------------------------------

describe("getTickerOwnData", () => {
  it("aggregates holdings, names the accounts, and rolls up trades and watch entries", () => {
    const deps = fakeDeps({
      positions: [
        position({ accountId: 1, valueCents: 200_000 }),
        position({ accountId: 2, valueCents: 400_000, quantity: 20, costCents: 300_000 }),
      ],
      transactions: [transaction(), transaction({ id: 2, ticker: "MSFT" })],
      accounts: [
        { id: 1, name: "Fidelity IRA" } as InvestmentAccount,
        { id: 2, name: "Chase Brokerage" } as InvestmentAccount,
      ],
      lists: [{ id: 7, name: "Long-term" } as StockWatchList],
      items: [
        {
          id: 3,
          watchListId: 7,
          ticker: "AAPL",
          shares: 0,
          priceWhenAddedCents: 16_000,
          addedDate: "2025-02-01",
          reminderMessage: "",
        } as StockWatchListItem,
      ],
    });

    const result = getTickerOwnData({ ticker: "aapl" }, deps);

    expect(result.ticker).toBe("AAPL");
    expect(result.isHeld).toBe(true);
    expect(result.isWatched).toBe(true);
    // Sorted by value, so the larger account leads.
    expect(result.holdings.map((row) => row.accountName)).toEqual([
      "Chase Brokerage",
      "Fidelity IRA",
    ]);
    expect(result.totals.valueCents).toBe(600_000);
    expect(result.totals.quantity).toBe(30);
    // The MSFT row must not leak into this ticker's history.
    expect(result.trades.transactions.map((row) => row.ticker)).toEqual(["AAPL"]);
    expect(result.watchEntries[0].watchListName).toBe("Long-term");
    expect(result.watchEntries[0].changeSinceAddedPct).toBeCloseTo(25, 6);
    expect(result.cusip).toBe("037833100");
  });

  it("labels the id-0 pseudo-account rather than looking it up", () => {
    const result = getTickerOwnData(
      { ticker: "AAPL" },
      fakeDeps({ positions: [position({ accountId: 0 })] }),
    );
    expect(result.holdings[0].accountName).toBe("Unassigned");
  });

  it("returns a zeroed, unheld record for a ticker we know nothing about", () => {
    const result = getTickerOwnData({ ticker: "ZZZZ" }, fakeDeps());

    expect(result.isHeld).toBe(false);
    expect(result.isWatched).toBe(false);
    expect(result.holdings).toEqual([]);
    expect(result.totals.valueCents).toBe(0);
    expect(result.type).toBeUndefined();
    expect(result.trades.transactions).toEqual([]);
  });

  it("rejects an empty ticker at the boundary", () => {
    expect(() => getTickerOwnData({ ticker: "   " }, fakeDeps())).toThrow();
  });
});

describe("getTickerQuote", () => {
  it("works out the day's move against the previous close", async () => {
    const quote = await getTickerQuote(fakeMarketClient({}), { ticker: "aapl" });

    expect(quote.ticker).toBe("AAPL");
    expect(quote.changeCents).toBe(1_000);
    expect(quote.changePct).toBeCloseTo((1_000 / 19_000) * 100, 6);
    expect(quote.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("reports a zero percentage rather than dividing by a zero previous close", async () => {
    const quote = await getTickerQuote(
      fakeMarketClient({}, { priceCents: 100, previousCloseCents: 0 }),
      { ticker: "AAPL" },
    );
    expect(quote.changePct).toBe(0);
  });
});

describe("getTickerPriceSeries", () => {
  it("defaults to the one-year window and summarizes it", async () => {
    const client = fakeMarketClient({ AAPL: series(10_000, 100, 5) });
    const result = await getTickerPriceSeries(client, { ticker: "AAPL" });

    expect(result.range).toBe("1y");
    expect(result.points).toHaveLength(5);
    expect(result.startCloseCents).toBe(10_000);
    expect(result.endCloseCents).toBe(10_400);
  });

  it("propagates a provider failure rather than returning an empty chart", async () => {
    await expect(
      getTickerPriceSeries(fakeMarketClient({}), { ticker: "AAPL", range: "3mo" }),
    ).rejects.toThrow(/No history/);
  });
});

describe("getTickerRisk", () => {
  /** An in-memory stand-in for `stk_ticker_risk_cache`, counting its writes. */
  function fakeRiskCache(seed?: TickerRisk) {
    const rows = new Map<string, TickerRisk>();
    if (seed) rows.set(seed.ticker, seed);
    let saveCount = 0;

    return {
      get: (ticker: string) => rows.get(ticker),
      save: (risk: TickerRisk) => {
        saveCount += 1;
        rows.set(risk.ticker, risk);
      },
      get saveCount() {
        return saveCount;
      },
    };
  }

  /** A stored row, distinguishable from anything the fake provider computes. */
  function storedRisk(overrides: Partial<TickerRisk> = {}): TickerRisk {
    return {
      ticker: "AAPL",
      annualizedVolPct: 11.5,
      dailyStdDevPct: 0.72,
      volatilityLabel: "Low",
      low52wCents: 1_000,
      high52wCents: 2_000,
      currentPriceCents: 1_500,
      rangePositionPct: 50,
      marketCorrelation: 0.42,
      marketBenchmarkTicker: "SPY",
      annualizedReturnPct: 7.5,
      sampleCount: 250,
      calculatedAt: "2020-01-01T00:00:00.000Z",
      ...overrides,
    };
  }

  it("computes volatility, the 52-week range and the benchmark correlation", async () => {
    const client = fakeMarketClient({
      AAPL: series(10_000, 100, 60),
      SPY: series(40_000, 200, 60),
    });

    const risk = await getTickerRisk(client, fakeRiskCache(), { ticker: "AAPL" });

    expect(risk.sampleCount).toBe(60);
    expect(risk.low52wCents).toBe(10_000);
    expect(risk.high52wCents).toBe(15_900);
    expect(risk.currentPriceCents).toBe(15_900);
    expect(risk.rangePositionPct).toBe(100);
    expect(risk.marketBenchmarkTicker).toBe("SPY");
    // Both legs rise monotonically, so the daily returns move together.
    expect(risk.marketCorrelation).not.toBeNull();
    expect(risk.marketCorrelation as number).toBeGreaterThan(0.9);
    expect(risk.volatilityLabel).toMatch(/Low|Moderate|High|Very High/);
  });

  it("still reports the ticker's own figures when the benchmark leg fails", async () => {
    const client = fakeMarketClient({ AAPL: series(10_000, 100, 60) });
    const risk = await getTickerRisk(client, fakeRiskCache(), { ticker: "AAPL" });

    expect(risk.marketCorrelation).toBeNull();
    expect(risk.annualizedVolPct).toBeGreaterThan(0);
  });

  it("throws when the ticker's own history cannot be fetched", async () => {
    await expect(
      getTickerRisk(fakeMarketClient({ SPY: series(1, 1, 60) }), fakeRiskCache(), {
        ticker: "AAPL",
      }),
    ).rejects.toThrow(/No history/);
  });

  it("stores what it computes on a cache miss", async () => {
    const cache = fakeRiskCache();
    const client = fakeMarketClient({ AAPL: series(10_000, 100, 60) });

    const risk = await getTickerRisk(client, cache, { ticker: "AAPL" });

    expect(cache.saveCount).toBe(1);
    expect(cache.get("AAPL")).toEqual(risk);
  });

  it("serves a stored row without touching the provider, however old it is", async () => {
    const cache = fakeRiskCache(storedRisk());
    // No history for any ticker: any provider call at all would throw.
    const client = fakeMarketClient({});

    const risk = await getTickerRisk(client, cache, { ticker: "AAPL" });

    expect(risk.calculatedAt).toBe("2020-01-01T00:00:00.000Z");
    expect(risk.annualizedVolPct).toBe(11.5);
    expect(cache.saveCount).toBe(0);
  });

  it("recomputes and overwrites the stored row when refresh is set", async () => {
    const cache = fakeRiskCache(storedRisk());
    const client = fakeMarketClient({ AAPL: series(10_000, 100, 60) });

    const risk = await getTickerRisk(client, cache, { ticker: "AAPL", refresh: true });

    expect(risk.sampleCount).toBe(60);
    expect(risk.calculatedAt).not.toBe("2020-01-01T00:00:00.000Z");
    expect(cache.saveCount).toBe(1);
    expect(cache.get("AAPL")?.sampleCount).toBe(60);
  });

  it("keeps the stored row when a refresh fails, rather than blanking the card", async () => {
    const cache = fakeRiskCache(storedRisk());
    const client = fakeMarketClient({});

    const risk = await getTickerRisk(client, cache, { ticker: "AAPL", refresh: true });

    expect(risk.calculatedAt).toBe("2020-01-01T00:00:00.000Z");
    expect(cache.saveCount).toBe(0);
  });

  it("looks the cache up by the upper-cased ticker", async () => {
    const cache = fakeRiskCache(storedRisk());
    const risk = await getTickerRisk(fakeMarketClient({}), cache, { ticker: " aapl " });

    expect(risk.ticker).toBe("AAPL");
    expect(cache.saveCount).toBe(0);
  });
});

describe("buildTickerEvents", () => {
  /** Epoch seconds for a local-calendar date, so `toIsoDateLocal` round-trips. */
  function at(date: string): number {
    const [year, month, day] = date.split("-").map(Number);
    return new Date(year, month - 1, day, 12).getTime() / 1000;
  }

  function closes(entries: [string, number][]): TickerClosePoint[] {
    return entries.map(([date, closeCents]) => ({ date, closeCents }));
  }

  it("works out the surprise on a beat and phrases it", () => {
    const feed = buildTickerEvents(
      "AAPL",
      [
        {
          timestamp: at("2026-08-01"),
          kind: "earnings",
          epsActualCents: 1_020,
          epsEstimateCents: 980,
        },
      ],
      closes([["2026-08-01", 18_744]]),
    );

    const [event] = feed.events;
    expect(event.summary).toBe("Earnings $10.20 EPS vs $9.80 est.");
    expect(event.epsSurpriseCents).toBe(40);
    expect(event.epsSurprisePct).toBeCloseTo(4.08, 2);
    expect(event.outcome).toBe("beat");
    expect(event.closeCents).toBe(18_744);
    expect(event.closeDate).toBeUndefined();
  });

  it("marks a miss and an in-line quarter", () => {
    const feed = buildTickerEvents(
      "AAPL",
      [
        {
          timestamp: at("2026-05-02"),
          kind: "earnings",
          epsActualCents: 915,
          epsEstimateCents: 940,
        },
        {
          timestamp: at("2026-02-02"),
          kind: "earnings",
          epsActualCents: 800,
          epsEstimateCents: 800,
        },
      ],
      [],
    );

    expect(feed.events.map((event) => event.outcome)).toEqual(["miss", "inline"]);
    expect(feed.events[0].epsSurpriseCents).toBe(-25);
  });

  it("leaves the surprise off a quarter that has no reported EPS yet", () => {
    const feed = buildTickerEvents(
      "AAPL",
      [{ timestamp: at("2026-11-01"), kind: "earnings", epsEstimateCents: 1_100 }],
      [],
    );

    const [event] = feed.events;
    expect(event.summary).toBe("Earnings");
    expect(event.outcome).toBeUndefined();
    expect(event.epsSurpriseCents).toBeUndefined();
  });

  it("describes dividends and splits", () => {
    const feed = buildTickerEvents(
      "AAPL",
      [
        { timestamp: at("2026-02-08"), kind: "dividend", amountCents: 25 },
        { timestamp: at("2026-01-05"), kind: "split", ratio: "4:1" },
      ],
      [],
    );

    expect(feed.events.map((event) => event.summary)).toEqual([
      "Dividend $0.25 / share",
      "Split 4:1",
    ]);
  });

  it("dates an event on a closed market to the last close before it, and says so", () => {
    // 2026-08-02 is a Sunday; the previous print is the Friday.
    const feed = buildTickerEvents(
      "AAPL",
      [{ timestamp: at("2026-08-02"), kind: "dividend", amountCents: 25 }],
      closes([
        ["2026-07-31", 18_700],
        ["2026-08-03", 18_900],
      ]),
    );

    const [event] = feed.events;
    expect(event.date).toBe("2026-08-02");
    expect(event.closeCents).toBe(18_700);
    expect(event.closeDate).toBe("2026-07-31");
  });

  it("leaves the price off an event older than any close it has", () => {
    const feed = buildTickerEvents(
      "AAPL",
      [{ timestamp: at("2020-01-02"), kind: "dividend", amountCents: 20 }],
      closes([["2026-08-03", 18_900]]),
    );

    expect(feed.events[0].closeCents).toBeUndefined();
    // A close *after* the event is not a price the event happened against.
    expect(feed.events[0].closeDate).toBeUndefined();
  });

  it("returns events newest first", () => {
    const feed = buildTickerEvents(
      "AAPL",
      [
        { timestamp: at("2026-01-05"), kind: "dividend", amountCents: 20 },
        { timestamp: at("2026-08-01"), kind: "dividend", amountCents: 25 },
        { timestamp: at("2026-05-02"), kind: "dividend", amountCents: 22 },
      ],
      [],
    );

    expect(feed.events.map((event) => event.date)).toEqual([
      "2026-08-01",
      "2026-05-02",
      "2026-01-05",
    ]);
  });

  it("flags that closes are missing rather than pretending the events are priced", () => {
    const feed = buildTickerEvents(
      "AAPL",
      [{ timestamp: at("2026-08-01"), kind: "dividend", amountCents: 25 }],
      [],
    );

    expect(feed.closesUnavailable).toBe(true);
    expect(feed.events).toHaveLength(1);
  });
});

describe("getTickerEvents", () => {
  function fakeEventsClient(events: MarketEvent[]): MarketEventsClient {
    return { async getEvents() { return events; } };
  }

  it("still returns the events when the closes leg fails", async () => {
    const feed = await getTickerEvents(
      fakeEventsClient([{ timestamp: 1_767_225_600, kind: "dividend", amountCents: 25 }]),
      // No history for AAPL, so `getHistory` throws.
      fakeMarketClient({}),
      { ticker: "AAPL" },
    );

    expect(feed.events).toHaveLength(1);
    expect(feed.closesUnavailable).toBe(true);
  });

  it("treats a ticker with no events as a success, not a failure", async () => {
    const feed = await getTickerEvents(fakeEventsClient([]), fakeMarketClient({}), {
      ticker: "AAPL",
    });

    expect(feed.ticker).toBe("AAPL");
    expect(feed.events).toEqual([]);
  });

  it("propagates a failure of the events leg itself", async () => {
    const client: MarketEventsClient = {
      async getEvents() {
        throw new Error("Yahoo events: HTTP 503");
      },
    };

    await expect(
      getTickerEvents(client, fakeMarketClient({}), { ticker: "AAPL" }),
    ).rejects.toThrow(/503/);
  });
});

describe("getTickerNewsFeed", () => {
  function fakeNewsClient(stories: RawNewsStory[]): TickerNewsClient {
    return { async searchStories() { return stories; } };
  }

  it("returns ranked stories capped at the requested limit", async () => {
    const client = fakeNewsClient([
      {
        title: "AAPL leads",
        publisher: "A",
        url: "https://example.com/1",
        publishedAt: "2026-08-05T10:00:00.000Z",
        relatedTickers: ["AAPL"],
      },
      {
        title: "Mentions apple",
        publisher: "B",
        url: "https://example.com/2",
        publishedAt: "2026-08-05T11:00:00.000Z",
        relatedTickers: ["SPY"],
      },
    ]);

    const feed = await getTickerNewsFeed(client, { ticker: "AAPL", limit: 1 }, "2026-08-05");

    expect(feed.ticker).toBe("AAPL");
    expect(feed.stories).toHaveLength(1);
    expect(feed.stories[0].title).toBe("AAPL leads");
  });

  it("returns an empty list for a quiet ticker instead of throwing", async () => {
    const feed = await getTickerNewsFeed(fakeNewsClient([]), { ticker: "AAPL" }, "2026-08-05");
    expect(feed.stories).toEqual([]);
  });

  it("rejects a limit outside the allowed range", async () => {
    await expect(
      getTickerNewsFeed(fakeNewsClient([]), { ticker: "AAPL", limit: 500 }, "2026-08-05"),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// The trade timeline
// ---------------------------------------------------------------------------

describe("transactionDate", () => {
  it("takes the calendar day from a plain date or a full instant", () => {
    expect(transactionDate("2025-06-01")).toBe("2025-06-01");
    expect(transactionDate("2025-06-01T14:32:00.000Z")).toBe("2025-06-01");
  });

  it("returns unparseable input unchanged rather than inventing a date", () => {
    expect(transactionDate("not a date")).toBe("not a date");
  });
});

describe("historyRangeCovering", () => {
  it("picks a window that reaches back past the oldest trade", () => {
    expect(historyRangeCovering("2026-07-20", "2026-08-05")).toBe("3mo");
    expect(historyRangeCovering("2026-03-05", "2026-08-05")).toBe("6mo");
    expect(historyRangeCovering("2025-10-05", "2026-08-05")).toBe("1y");
    expect(historyRangeCovering("2024-10-05", "2026-08-05")).toBe("2y");
    expect(historyRangeCovering("2022-08-05", "2026-08-05")).toBe("5y");
    expect(historyRangeCovering("2018-08-05", "2026-08-05")).toBe("10y");
    expect(historyRangeCovering("2000-01-01", "2026-08-05")).toBe("max");
  });

  it("falls back to the widest window for an unparseable date", () => {
    expect(historyRangeCovering("garbage", "2026-08-05")).toBe("max");
  });
});

describe("buildTradeTimeline", () => {
  const closes = [
    { date: "2025-06-02", closeCents: 14_500 },
    { date: "2025-06-04", closeCents: 15_400 },
    { date: "2025-08-01", closeCents: 20_000 },
    { date: "2025-08-05", closeCents: 21_500 },
    { date: "2026-08-04", closeCents: 30_000 },
  ];

  it("brackets each trade with the nearest trading day either side, in order", () => {
    const result = buildTradeTimeline(
      "AAPL",
      [transaction({ id: 1, transactionAt: "2025-06-03" })],
      closes,
      [],
    );

    expect(result.points.map((point) => [point.date, point.kind])).toEqual([
      ["2025-06-02", "prevClose"],
      ["2025-06-03", "trade"],
      ["2025-06-04", "nextClose"],
      ["2026-08-04", "current"],
    ]);
    expect(result.points[0].pricePerShareCents).toBe(14_500);
    expect(result.points[1].pricePerShareCents).toBe(15_000);
    expect(result.points[1].action).toBe("Buy");
    expect(result.points[1].numberOfShares).toBe(10);
    expect(result.currentPriceCents).toBe(30_000);
  });

  it("skips a weekend rather than assuming the literal calendar day", () => {
    // 2025-08-02 is a Saturday: the bracket must be Friday's and Tuesday's closes.
    const result = buildTradeTimeline(
      "AAPL",
      [transaction({ id: 1, transactionAt: "2025-08-02" })],
      closes,
      [],
    );
    const bracket = result.points.filter((point) => point.kind !== "current");
    expect(bracket.map((point) => point.date)).toEqual([
      "2025-08-01",
      "2025-08-02",
      "2025-08-05",
    ]);
  });

  it("never emits a close on a date that already carries a trade", () => {
    const result = buildTradeTimeline(
      "AAPL",
      [transaction({ id: 1, transactionAt: "2025-08-05" })],
      closes,
      [],
    );
    const onTradeDate = result.points.filter((point) => point.date === "2025-08-05");
    expect(onTradeDate).toHaveLength(1);
    expect(onTradeDate[0].kind).toBe("trade");
  });

  it("emits a shared bracket date once when two trades sit close together", () => {
    const result = buildTradeTimeline(
      "AAPL",
      [
        transaction({ id: 1, transactionAt: "2025-08-02" }),
        transaction({ id: 2, transactionAt: "2025-08-04" }),
      ],
      closes,
      [],
    );
    // 2025-08-05 is the next close for both trades; it must appear once.
    expect(result.points.filter((point) => point.date === "2025-08-05")).toHaveLength(1);
    expect(result.points.filter((point) => point.kind === "trade")).toHaveLength(2);
  });

  it("attaches stories to the point sharing their published date", () => {
    const result = buildTradeTimeline(
      "AAPL",
      [transaction({ id: 1, transactionAt: "2025-06-03" })],
      closes,
      [
        {
          title: "AAPL moves",
          publisher: "Reuters",
          url: "https://example.com/x",
          publishedAt: "2025-06-03T15:00:00.000Z",
          relatedTickers: ["AAPL"],
          isPrimarySubject: true,
          isFromToday: false,
        },
      ],
    );

    const trade = result.points.find((point) => point.kind === "trade");
    expect(trade?.stories.map((story) => story.title)).toEqual(["AAPL moves"]);
    expect(result.points.find((point) => point.kind === "prevClose")?.stories).toEqual([]);
  });

  it("reports a trade the provider had no history around", () => {
    const result = buildTradeTimeline(
      "AAPL",
      [transaction({ id: 1, transactionAt: "2025-06-03" })],
      [],
      [],
    );
    expect(result.datesWithoutCloses).toEqual(["2025-06-03"]);
    expect(result.points.map((point) => point.kind)).toEqual(["trade"]);
    expect(result.currentPriceCents).toBe(0);
  });

  it("attaches an event to a point already sitting on its date", () => {
    const result = buildTradeTimeline(
      "AAPL",
      [transaction({ id: 1, transactionAt: "2025-06-03" })],
      closes,
      [],
      // 2025-06-04 is already the trade's nextClose.
      [{ timestamp: Date.parse("2025-06-04T12:00:00") / 1000, kind: "dividend", amountCents: 24 }],
    );

    const onDate = result.points.filter((point) => point.date === "2025-06-04");
    expect(onDate).toHaveLength(1);
    expect(onDate[0].kind).toBe("nextClose");
    expect(onDate[0].events.map((event) => event.kind)).toEqual(["dividend"]);
    expect(result.unplottedEventCount).toBe(0);
  });

  it("gives an event its own point, priced at that day's close, when no point exists", () => {
    const result = buildTradeTimeline(
      "AAPL",
      [transaction({ id: 1, transactionAt: "2025-06-03" })],
      closes,
      [],
      [{ timestamp: Date.parse("2025-08-01T12:00:00") / 1000, kind: "earnings", epsActualCents: 150 }],
    );

    const added = result.points.find((point) => point.date === "2025-08-01");
    expect(added?.kind).toBe("event");
    // Priced from the close, not invented.
    expect(added?.pricePerShareCents).toBe(20_000);
    expect(added?.events[0].kind).toBe("earnings");
  });

  it("dates an event on a closed market to the last close on or before it", () => {
    const result = buildTradeTimeline(
      "AAPL",
      [transaction({ id: 1, transactionAt: "2025-06-03" })],
      closes,
      [],
      // 2025-08-03 is a Sunday; the last close on or before is Friday 2025-08-01.
      [{ timestamp: Date.parse("2025-08-03T12:00:00") / 1000, kind: "dividend", amountCents: 24 }],
    );

    expect(result.points.find((point) => point.date === "2025-08-03")).toBeUndefined();
    expect(
      result.points.find((point) => point.date === "2025-08-01")?.events[0].kind,
    ).toBe("dividend");
  });

  it("counts an event with no close to date it to rather than guessing a price", () => {
    const result = buildTradeTimeline(
      "AAPL",
      [transaction({ id: 1, transactionAt: "2025-06-03" })],
      closes,
      [],
      // Before the oldest close in the window.
      [{ timestamp: Date.parse("2020-01-02T12:00:00") / 1000, kind: "dividend", amountCents: 24 }],
    );

    expect(result.unplottedEventCount).toBe(1);
    expect(result.points.every((point) => point.events.length === 0)).toBe(true);
  });

  it("carries the trade's own note onto its point", () => {
    const result = buildTradeTimeline(
      "AAPL",
      [transaction({ id: 1, transactionAt: "2025-06-03", note: "topped up on the dip" })],
      closes,
      [],
    );
    expect(result.points.find((point) => point.kind === "trade")?.note).toBe(
      "topped up on the dip",
    );
  });

  it("carries the avg/max/min trade price alongside the points", () => {
    const result = buildTradeTimeline(
      "AAPL",
      [
        transaction({ id: 1, transactionAt: "2025-06-03", pricePerShareCents: 10_000 }),
        transaction({ id: 2, transactionAt: "2025-08-04", pricePerShareCents: 20_000 }),
      ],
      closes,
      [],
    );
    expect(result.tradeStats).toMatchObject({
      count: 2,
      avgPricePerShareCents: 15_000,
      maxPricePerShareCents: 20_000,
      minPricePerShareCents: 10_000,
    });
  });
});

describe("getTickerTradeTimeline", () => {
  function newsClient(stories: RawNewsStory[] = [], fail = false): TickerNewsClient {
    return {
      async searchStories() {
        if (fail) throw new Error("news provider down");
        return stories;
      },
    };
  }

  it("filters to the ticker and brackets its trades with provider closes", async () => {
    const client = fakeMarketClient({ AAPL: series(10_000, 100, 40) });
    const result = await getTickerTradeTimeline(
      { marketData: client, news: newsClient() },
      [
        transaction({ id: 1, transactionAt: "2023-11-16", pricePerShareCents: 10_500 }),
        transaction({ id: 2, ticker: "MSFT", transactionAt: "2023-11-16" }),
      ],
      { ticker: "aapl" },
      "2026-08-05",
    );

    expect(result.ticker).toBe("AAPL");
    expect(result.points.filter((point) => point.kind === "trade")).toHaveLength(1);
    expect(result.points.some((point) => point.kind === "prevClose")).toBe(true);
    expect(result.newsUnavailable).toBe(false);
  });

  it("makes no provider call at all when the ticker has no trades", async () => {
    let calls = 0;
    const client: MarketDataClient = {
      async getQuote() {
        throw new Error("unused");
      },
      async getHistory() {
        calls += 1;
        return [];
      },
    };

    const result = await getTickerTradeTimeline(
      { marketData: client, news: newsClient() },
      [],
      { ticker: "AAPL" },
      "2026-08-05",
    );

    expect(calls).toBe(0);
    expect(result.points).toEqual([]);
    expect(result.tradeStats.count).toBe(0);
  });

  it("still returns the chart when the news leg fails", async () => {
    const client = fakeMarketClient({ AAPL: series(10_000, 100, 40) });
    const result = await getTickerTradeTimeline(
      { marketData: client, news: newsClient([], true) },
      [transaction({ id: 1, transactionAt: "2023-11-16" })],
      { ticker: "AAPL" },
      "2026-08-05",
    );

    expect(result.newsUnavailable).toBe(true);
    expect(result.points.length).toBeGreaterThan(0);
  });

  it("still returns the chart when the events leg fails", async () => {
    const client = fakeMarketClient({ AAPL: series(10_000, 100, 40) });
    const result = await getTickerTradeTimeline(
      {
        marketData: client,
        events: {
          async getEvents() {
            throw new Error("events provider down");
          },
        },
      },
      [transaction({ id: 1, transactionAt: "2023-11-16" })],
      { ticker: "AAPL" },
      "2026-08-05",
    );

    expect(result.eventsUnavailable).toBe(true);
    expect(result.points.length).toBeGreaterThan(0);
  });

  it("propagates a price-history failure, since there'd be no chart to draw", async () => {
    await expect(
      getTickerTradeTimeline(
        { marketData: fakeMarketClient({}) },
        [transaction({ id: 1, transactionAt: "2023-11-16" })],
        { ticker: "AAPL" },
        "2026-08-05",
      ),
    ).rejects.toThrow(/No history/);
  });
});
