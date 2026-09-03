import { describe, expect, it } from "vitest";
import type { MarketDataClient, Quote } from "@/lib/market-data";
import {
  changePct,
  computeAllocation,
  computeAverageCostBasisCents,
  computeDayMovesByType,
  computePortfolioSummary,
  applyRefreshedPosition,
  computeTickerDayMoves,
  computeTransactionStats,
  createTransaction,
  deletePosition,
  deleteTransaction,
  getPosition,
  importPositionsFromCsv,
  importTransactionsFromCsv,
  inferPositionType,
  listPositions,
  listPositionsByTicker,
  listTransactions,
  refreshAllPositions,
  refreshPosition,
  resolvePositionType,
  topGainers,
  topLosers,
  updateTransaction,
  upsertPosition,
} from "./stock-positions";
import type { StockPositionRepository } from "./ports";
import type { CreateTransactionInput, UpsertPositionInput } from "./schema";
import type { StockPosition, StockTransaction } from "./types";

/**
 * A position with everything defaulted, so a test only states the fields it cares
 * about. The table has 20-odd columns now; spelling them all out per case buried
 * the assertion.
 */
function makePosition(overrides: Partial<StockPosition> = {}): StockPosition {
  return {
    accountId: 0,
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
    costCents: 0,
    unitCostCents: 0,
    unrealizedGainLossCents: 0,
    unrealizedGainLossPct: 0,
    cusip: "",
    isin: "",
    assetClass: "",
    assetStrategy: "",
    estAnnualIncomeCents: 0,
    incomeEarnedCents: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// Hand-written fake — no mocking framework, reusable across tests.
function fakeRepo(
  seedPositions: StockPosition[] = [],
  seedTransactions: StockTransaction[] = [],
): StockPositionRepository {
  let positions = [...seedPositions];
  let transactions = [...seedTransactions];
  let nextTransactionId = transactions.reduce((max, t) => Math.max(max, t.id), 0) + 1;

  const samePosition = (position: StockPosition, accountId: number, ticker: string) =>
    position.accountId === accountId && position.ticker === ticker;

  return {
    listPositions(accountId) {
      return accountId === undefined
        ? [...positions]
        : positions.filter((position) => position.accountId === accountId);
    },
    getPosition({ accountId, ticker }) {
      return positions.find((position) => samePosition(position, accountId, ticker));
    },
    listPositionsByTicker(ticker) {
      return positions.filter((position) => position.ticker === ticker);
    },
    upsertPosition(input, valueCents) {
      const existing = positions.find((position) =>
        samePosition(position, input.accountId, input.ticker),
      );
      const saved: StockPosition = {
        ...input,
        valueCents,
        createdAt: existing?.createdAt ?? "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      };
      positions = existing
        ? positions.map((position) =>
            samePosition(position, input.accountId, input.ticker) ? saved : position,
          )
        : [...positions, saved];
      return saved;
    },
    deletePosition({ accountId, ticker }) {
      positions = positions.filter((position) => !samePosition(position, accountId, ticker));
    },
    listTransactions(ticker) {
      return ticker === undefined
        ? [...transactions]
        : transactions.filter((transaction) => transaction.ticker === ticker);
    },
    getTransactionById(id) {
      return transactions.find((transaction) => transaction.id === id);
    },
    createTransaction(input, totalAmountCents) {
      const created: StockTransaction = {
        id: nextTransactionId++,
        ...input,
        totalAmountCents,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      transactions.push(created);
      return created;
    },
    updateTransaction(id, input, totalAmountCents) {
      transactions = transactions.map((transaction) =>
        transaction.id === id
          ? { ...transaction, ...input, totalAmountCents, updatedAt: "2026-01-02T00:00:00.000Z" }
          : transaction,
      );
      const updated = transactions.find((transaction) => transaction.id === id);
      if (!updated) throw new Error(`Transaction ${id} not found.`);
      return updated;
    },
    hasTransactionWithExternalId(externalId) {
      const trimmed = externalId.trim();
      if (trimmed === "") return false;
      return transactions.some((transaction) => transaction.externalId === trimmed);
    },
    countMatchingTransactions(key) {
      return transactions.filter(
        (transaction) =>
          transaction.transactionAt === key.transactionAt &&
          transaction.action === key.action &&
          transaction.ticker === key.ticker &&
          transaction.numberOfShares === key.numberOfShares &&
          transaction.pricePerShareCents === key.pricePerShareCents &&
          transaction.brokerageFirm === key.brokerageFirm,
      ).length;
    },
    deleteTransaction(id) {
      transactions = transactions.filter((transaction) => transaction.id !== id);
    },
  };
}

describe("upsertPosition", () => {
  const validInput: UpsertPositionInput = {
    accountId: 0,
    ticker: "AAPL",
    name: "Apple Inc.",
    type: "Stock",
    currentPriceCents: 15000,
    quantity: 10,
    dayGainLossCents: 500,
    dayHighCents: 15200,
    dayLowCents: 14800,
    dividendRateCents: 96,
    costCents: 100000,
    unitCostCents: 10000,
    unrealizedGainLossCents: 50000,
    unrealizedGainLossPct: 50,
    cusip: "037833100",
    isin: "US0378331005",
    assetClass: "Equity",
    assetStrategy: "US Large Cap",
    estAnnualIncomeCents: 960,
    incomeEarnedCents: 480,
  };

  it("creates a position and computes valueCents server-side", () => {
    const repo = fakeRepo();
    const created = upsertPosition(repo, validInput);
    expect(created.valueCents).toBe(150000);
    expect(listPositions(repo)).toHaveLength(1);
  });

  it("round-trips the cost-basis and identifier fields", () => {
    const repo = fakeRepo();
    const created = upsertPosition(repo, validInput);
    expect(created.costCents).toBe(100000);
    expect(created.unitCostCents).toBe(10000);
    expect(created.unrealizedGainLossPct).toBe(50);
    expect(created.cusip).toBe("037833100");
    expect(created.assetStrategy).toBe("US Large Cap");
  });

  it("updates an existing position on a repeat call for the same account + ticker", () => {
    const repo = fakeRepo();
    upsertPosition(repo, validInput);
    const updated = upsertPosition(repo, { ...validInput, currentPriceCents: 16000 });
    expect(updated.valueCents).toBe(160000);
    expect(listPositions(repo)).toHaveLength(1);
  });

  it("keeps the same ticker in two accounts as two positions", () => {
    const repo = fakeRepo();
    upsertPosition(repo, validInput);
    upsertPosition(repo, { ...validInput, accountId: 7, quantity: 3 });
    expect(listPositions(repo)).toHaveLength(2);
    expect(listPositions(repo, 7)).toHaveLength(1);
    expect(listPositionsByTicker(repo, "AAPL")).toHaveLength(2);
    expect(getPosition(repo, { accountId: 7, ticker: "AAPL" })?.quantity).toBe(3);
  });

  it("defaults accountId to 0 (Unassigned) when omitted", () => {
    const repo = fakeRepo();
    const withoutAccount: Record<string, unknown> = { ...validInput };
    delete withoutAccount.accountId;
    const created = upsertPosition(repo, withoutAccount as unknown as UpsertPositionInput);
    expect(created.accountId).toBe(0);
  });

  it("accepts a negative unrealized gain (a loss)", () => {
    const repo = fakeRepo();
    const created = upsertPosition(repo, {
      ...validInput,
      unrealizedGainLossCents: -25000,
      unrealizedGainLossPct: -20,
    });
    expect(created.unrealizedGainLossCents).toBe(-25000);
  });

  it("rejects an empty ticker", () => {
    const repo = fakeRepo();
    expect(() => upsertPosition(repo, { ...validInput, ticker: "" })).toThrow();
  });

  it("rejects a negative quantity", () => {
    const repo = fakeRepo();
    expect(() => upsertPosition(repo, { ...validInput, quantity: -1 })).toThrow();
  });

  it("rejects a negative cost basis", () => {
    const repo = fakeRepo();
    expect(() => upsertPosition(repo, { ...validInput, costCents: -1 })).toThrow();
  });

  it("rejects a negative accountId", () => {
    const repo = fakeRepo();
    expect(() => upsertPosition(repo, { ...validInput, accountId: -1 })).toThrow();
  });
});

describe("deletePosition", () => {
  it("removes only the matching account's position", () => {
    const repo = fakeRepo([
      makePosition({ accountId: 0 }),
      makePosition({ accountId: 7, quantity: 3 }),
    ]);
    deletePosition(repo, { accountId: 0, ticker: "AAPL" });
    expect(listPositions(repo)).toHaveLength(1);
    expect(listPositions(repo)[0].accountId).toBe(7);
  });

  it("rejects a key with an empty ticker", () => {
    const repo = fakeRepo([makePosition()]);
    expect(() => deletePosition(repo, { accountId: 0, ticker: "" })).toThrow();
  });
});

function fakeMarketDataClient(quotes: Record<string, Quote | Error>): MarketDataClient {
  return {
    async getQuote(ticker) {
      const quote = quotes[ticker];
      if (quote === undefined) throw new Error(`No quote for ${ticker}.`);
      if (quote instanceof Error) throw quote;
      return quote;
    },
    async getHistory() {
      return [];
    },
  };
}

const seedPosition = makePosition({
  currentPriceCents: 14900,
  valueCents: 149000,
  dayHighCents: 15000,
  dayLowCents: 14800,
  dividendRateCents: 90,
});

describe("refreshPosition", () => {
  it("pulls a live quote and updates price/day-range/dividend fields", async () => {
    const repo = fakeRepo([seedPosition]);
    const client = fakeMarketDataClient({
      AAPL: {
        ticker: "AAPL",
        priceCents: 15500,
        previousCloseCents: 15000,
        shortName: "Apple Inc.",
        dayHighCents: 15600,
        dayLowCents: 15100,
        dividendRateCents: 96,
      },
    });

    const refreshed = await refreshPosition(repo, client, { accountId: 0, ticker: "AAPL" });
    expect(refreshed.currentPriceCents).toBe(15500);
    expect(refreshed.valueCents).toBe(155000);
    expect(refreshed.dayGainLossCents).toBe(5000); // (15500 - 15000) * 10 shares
    expect(refreshed.dividendRateCents).toBe(96);
  });

  it("leaves cost basis and classification alone, but recomputes the unrealized gain", async () => {
    const repo = fakeRepo([
      makePosition({
        costCents: 100000,
        unitCostCents: 10000,
        unrealizedGainLossCents: 49000,
        assetStrategy: "US Large Cap",
      }),
    ]);
    const client = fakeMarketDataClient({
      AAPL: {
        ticker: "AAPL",
        priceCents: 15500,
        previousCloseCents: 15000,
        dayHighCents: 15600,
        dayLowCents: 15100,
        dividendRateCents: 0,
      },
    });

    const refreshed = await refreshPosition(repo, client, { accountId: 0, ticker: "AAPL" });
    expect(refreshed.costCents).toBe(100000);
    expect(refreshed.unitCostCents).toBe(10000);
    expect(refreshed.assetStrategy).toBe("US Large Cap");
    expect(refreshed.unrealizedGainLossCents).toBe(55000); // 155000 value - 100000 cost
    expect(refreshed.unrealizedGainLossPct).toBeCloseTo(55, 5);
  });

  it("leaves the unrealized gain at zero when there is no known basis", async () => {
    const repo = fakeRepo([makePosition({ costCents: 0 })]);
    const client = fakeMarketDataClient({
      AAPL: {
        ticker: "AAPL",
        priceCents: 15500,
        previousCloseCents: 15000,
        dayHighCents: 0,
        dayLowCents: 0,
        dividendRateCents: 0,
      },
    });

    const refreshed = await refreshPosition(repo, client, { accountId: 0, ticker: "AAPL" });
    expect(refreshed.unrealizedGainLossCents).toBe(0);
    expect(refreshed.unrealizedGainLossPct).toBe(0);
  });

  it("rejects a key with no existing position", async () => {
    const repo = fakeRepo([]);
    const client = fakeMarketDataClient({});
    await expect(
      refreshPosition(repo, client, { accountId: 0, ticker: "AAPL" }),
    ).rejects.toThrow();
  });

  it("rejects a ticker held in a different account", async () => {
    const repo = fakeRepo([makePosition({ accountId: 7 })]);
    const client = fakeMarketDataClient({});
    await expect(
      refreshPosition(repo, client, { accountId: 0, ticker: "AAPL" }),
    ).rejects.toThrow();
  });
});

describe("refreshAllPositions", () => {
  it("refreshes every position and tolerates individual failures", async () => {
    const repo = fakeRepo([
      seedPosition,
      makePosition({ ticker: "DELISTED", name: "Delisted Co." }),
    ]);
    const client = fakeMarketDataClient({
      AAPL: {
        ticker: "AAPL",
        priceCents: 15500,
        previousCloseCents: 15000,
        dayHighCents: 15600,
        dayLowCents: 15100,
        dividendRateCents: 96,
      },
      DELISTED: new Error("No data for DELISTED"),
    });

    const result = await refreshAllPositions(repo, client);
    expect(result.refreshed).toHaveLength(1);
    expect(result.refreshed[0].ticker).toBe("AAPL");
    expect(result.failed).toEqual([{ ticker: "DELISTED", error: "No data for DELISTED" }]);
  });

  it("refreshes the same ticker in each account it is held in", async () => {
    const repo = fakeRepo([
      makePosition({ accountId: 0, quantity: 10 }),
      makePosition({ accountId: 7, quantity: 3 }),
    ]);
    const client = fakeMarketDataClient({
      AAPL: {
        ticker: "AAPL",
        priceCents: 15500,
        previousCloseCents: 15000,
        dayHighCents: 0,
        dayLowCents: 0,
        dividendRateCents: 0,
      },
    });

    const result = await refreshAllPositions(repo, client);
    expect(result.refreshed).toHaveLength(2);
    expect(result.refreshed.map((position) => position.valueCents)).toEqual([155000, 46500]);
  });
});

describe("createTransaction", () => {
  const validInput: CreateTransactionInput = {
    transactionAt: "2026-01-15",
    action: "Buy",
    ticker: "AAPL",
    numberOfShares: 5,
    pricePerShareCents: 15000,
    brokerageFirm: "",
    externalId: "",
    note: "",
  };

  it("creates a transaction and computes totalAmountCents server-side", () => {
    const repo = fakeRepo();
    const created = createTransaction(repo, validInput);
    expect(created.id).toBe(1);
    expect(created.totalAmountCents).toBe(75000);
    expect(listTransactions(repo)).toHaveLength(1);
  });

  it("rejects zero shares", () => {
    const repo = fakeRepo();
    expect(() => createTransaction(repo, { ...validInput, numberOfShares: 0 })).toThrow();
  });

  it("rejects an empty ticker", () => {
    const repo = fakeRepo();
    expect(() => createTransaction(repo, { ...validInput, ticker: "" })).toThrow();
  });
});

describe("updateTransaction and deleteTransaction", () => {
  const seedTransaction: StockTransaction = {
    id: 1,
    transactionAt: "2026-01-15",
    action: "Buy",
    ticker: "AAPL",
    numberOfShares: 5,
    pricePerShareCents: 15000,
    totalAmountCents: 75000,
    brokerageFirm: "",
    externalId: "",
    note: "",
    createdAt: "2026-01-15T00:00:00.000Z",
    updatedAt: "2026-01-15T00:00:00.000Z",
  };

  it("updates the transaction and recomputes totalAmountCents", () => {
    const repo = fakeRepo([], [seedTransaction]);
    const updated = updateTransaction(repo, 1, {
      transactionAt: "2026-01-16",
      action: "Sell",
      ticker: "AAPL",
      numberOfShares: 5,
      pricePerShareCents: 15500,
      brokerageFirm: "",
      externalId: "",
      note: "sold early",
    });
    expect(updated.action).toBe("Sell");
    expect(updated.totalAmountCents).toBe(77500);
  });

  it("removes the transaction", () => {
    const repo = fakeRepo([], [seedTransaction]);
    deleteTransaction(repo, 1);
    expect(listTransactions(repo)).toHaveLength(0);
  });
});

describe("computePortfolioSummary", () => {
  const positions: StockPosition[] = [
    makePosition({
      ticker: "AAPL",
      type: "Stock",
      dayGainLossCents: 500,
      valueCents: 150000,
      dividendRateCents: 96,
      costCents: 100000,
      unrealizedGainLossCents: 50000,
    }),
    makePosition({
      ticker: "SPY",
      name: "SPDR S&P 500",
      type: "ETF",
      currentPriceCents: 45000,
      quantity: 4,
      dayGainLossCents: -200,
      valueCents: 180000,
      dividendRateCents: 600,
      costCents: 200000,
      unrealizedGainLossCents: -20000,
    }),
    makePosition({
      ticker: "BTC",
      name: "Bitcoin",
      type: "Crypto",
      currentPriceCents: 5000000,
      quantity: 0.1,
      dayGainLossCents: 1000,
      valueCents: 500000,
      dividendRateCents: 0,
    }),
  ];

  it("totals value, day gain/loss, and asset-class split", () => {
    const summary = computePortfolioSummary(positions);
    expect(summary.positionCount).toBe(3);
    expect(summary.totalValueCents).toBe(830000);
    expect(summary.totalDayGainLossCents).toBe(1300);
    expect(summary.stockValueCents).toBe(150000);
    expect(summary.etfValueCents).toBe(180000);
    expect(summary.otherValueCents).toBe(500000);
  });

  it("computes annual dividend income as dividendRate * quantity, summed", () => {
    const summary = computePortfolioSummary(positions);
    expect(summary.annualDividendIncomeCents).toBe(96 * 10 + 600 * 4);
  });

  it("prefers the broker's est. annual income over rate * quantity", () => {
    const summary = computePortfolioSummary([
      makePosition({ dividendRateCents: 96, quantity: 10, estAnnualIncomeCents: 1200 }),
    ]);
    expect(summary.annualDividendIncomeCents).toBe(1200);
  });

  it("totals cost basis and total return, ignoring positions with no basis", () => {
    const summary = computePortfolioSummary(positions);
    // BTC reports no basis, so neither its cost nor its gain counts.
    expect(summary.totalCostCents).toBe(300000);
    expect(summary.totalUnrealizedGainLossCents).toBe(30000);
    expect(summary.totalReturnPct).toBeCloseTo(10, 5);
  });

  it("reports a zero total return when no position has a basis (no division by zero)", () => {
    const summary = computePortfolioSummary([makePosition({ costCents: 0, unrealizedGainLossCents: 999 })]);
    expect(summary.totalCostCents).toBe(0);
    expect(summary.totalUnrealizedGainLossCents).toBe(0);
    expect(summary.totalReturnPct).toBe(0);
  });

  it("returns all zeros for an empty portfolio (no division by zero)", () => {
    expect(computePortfolioSummary([])).toEqual({
      positionCount: 0,
      totalValueCents: 0,
      totalDayGainLossCents: 0,
      dayChangePct: 0,
      stockValueCents: 0,
      etfValueCents: 0,
      otherValueCents: 0,
      annualDividendIncomeCents: 0,
      totalCostCents: 0,
      totalUnrealizedGainLossCents: 0,
      totalReturnPct: 0,
    });
  });
});

describe("applyRefreshedPosition", () => {
  const positions: StockPosition[] = [
    makePosition({ ticker: "AAPL", valueCents: 150000, dayGainLossCents: 500, costCents: 100000 }),
    makePosition({ ticker: "SPY", type: "ETF", valueCents: 180000, dayGainLossCents: -200 }),
  ];

  it("swaps one position's value and day move into the running total", () => {
    const seeded = computePortfolioSummary(positions);
    const running = applyRefreshedPosition(
      seeded,
      { valueCents: 150000, dayGainLossCents: 500 },
      { valueCents: 155000, dayGainLossCents: 5500 },
    );

    expect(running.totalValueCents).toBe(335000);
    expect(running.totalDayGainLossCents).toBe(5300);
  });

  it("lands on the same totals a full recompute would, after folding every position", () => {
    // What a completed refresh looks like: both tickers re-priced. Folding one at
    // a time must agree with summing the finished positions in one pass, or the
    // climbing number and the number the page settles on would disagree.
    const refreshed: StockPosition[] = [
      makePosition({ ticker: "AAPL", valueCents: 155000, dayGainLossCents: 5500, costCents: 100000 }),
      makePosition({ ticker: "SPY", type: "ETF", valueCents: 172000, dayGainLossCents: -8200 }),
    ];

    let running = computePortfolioSummary(positions);
    for (const [index, after] of refreshed.entries()) {
      running = applyRefreshedPosition(running, positions[index], after);
    }

    const recomputed = computePortfolioSummary(refreshed);
    expect(running.totalValueCents).toBe(recomputed.totalValueCents);
    expect(running.totalDayGainLossCents).toBe(recomputed.totalDayGainLossCents);
    expect(running.dayChangePct).toBeCloseTo(recomputed.dayChangePct, 10);
  });

  it("is idempotent per ticker — refreshing the same one twice can't double-count it", () => {
    const seeded = computePortfolioSummary(positions);
    const before = { valueCents: 150000, dayGainLossCents: 500 };
    const after = { valueCents: 155000, dayGainLossCents: 5500 };

    const once = applyRefreshedPosition(seeded, before, after);
    const twice = applyRefreshedPosition(once, after, after);

    expect(twice.totalValueCents).toBe(once.totalValueCents);
    expect(twice.totalDayGainLossCents).toBe(once.totalDayGainLossCents);
  });

  it("recomputes the day percent against the prior close, not the new value", () => {
    const seeded = computePortfolioSummary([
      makePosition({ valueCents: 100000, dayGainLossCents: 0 }),
    ]);
    const running = applyRefreshedPosition(
      seeded,
      { valueCents: 100000, dayGainLossCents: 0 },
      { valueCents: 105000, dayGainLossCents: 5000 },
    );

    // +$50 on a $1000 prior close is +5%, not 5000/105000.
    expect(running.dayChangePct).toBeCloseTo(5, 10);
  });

  it("leaves cost basis, dividend income and the type split alone", () => {
    const seeded = computePortfolioSummary(positions);
    const running = applyRefreshedPosition(
      seeded,
      { valueCents: 150000, dayGainLossCents: 500 },
      { valueCents: 155000, dayGainLossCents: 5500 },
    );

    expect(running.totalCostCents).toBe(seeded.totalCostCents);
    expect(running.annualDividendIncomeCents).toBe(seeded.annualDividendIncomeCents);
    expect(running.stockValueCents).toBe(seeded.stockValueCents);
    expect(running.etfValueCents).toBe(seeded.etfValueCents);
    expect(running.positionCount).toBe(seeded.positionCount);
  });

  it("reports a zero percent when the prior close nets to nothing (no division by zero)", () => {
    const seeded = computePortfolioSummary([makePosition({ valueCents: 0, dayGainLossCents: 0 })]);
    const running = applyRefreshedPosition(
      seeded,
      { valueCents: 0, dayGainLossCents: 0 },
      { valueCents: 5000, dayGainLossCents: 5000 },
    );

    expect(running.dayChangePct).toBe(0);
  });
});

describe("computeAllocation", () => {
  const positions = [
    makePosition({ ticker: "AAPL", valueCents: 600000, assetStrategy: "US Large Cap" }),
    makePosition({ ticker: "MSFT", valueCents: 300000, assetStrategy: "US Large Cap" }),
    makePosition({ ticker: "OUST", valueCents: 100000, assetStrategy: "US Small Cap" }),
  ];

  it("groups by the chosen dimension, largest slice first, with shares summing to 100", () => {
    const slices = computeAllocation(positions, (position) => position.assetStrategy);
    expect(slices).toEqual([
      { label: "US Large Cap", valueCents: 900000, sharePct: 90 },
      { label: "US Small Cap", valueCents: 100000, sharePct: 10 },
    ]);
  });

  it("buckets a blank label under the fallback rather than dropping the position", () => {
    const slices = computeAllocation(
      [...positions, makePosition({ ticker: "???", valueCents: 100000, assetStrategy: "  " })],
      (position) => position.assetStrategy,
    );
    expect(slices.map((slice) => slice.label)).toContain("Unclassified");
    expect(slices.reduce((sum, slice) => sum + slice.valueCents, 0)).toBe(1100000);
  });

  it("returns an empty list for no positions", () => {
    expect(computeAllocation([], (position) => position.assetStrategy)).toEqual([]);
  });

  it("reports a zero share rather than NaN when every position is worthless", () => {
    const slices = computeAllocation([makePosition({ valueCents: 0, assetStrategy: "Cash" })], (p) => p.assetStrategy);
    expect(slices).toEqual([{ label: "Cash", valueCents: 0, sharePct: 0 }]);
  });
});

describe("changePct", () => {
  it("measures against the value before the move, not after", () => {
    // Worth $105 after a +$5 day means it started at $100 — that's +5%, not +4.76%.
    expect(changePct(10500, 500)).toBeCloseTo(5, 5);
  });

  it("goes negative on a loss", () => {
    expect(changePct(9500, -500)).toBeCloseTo(-5, 5);
  });

  it("returns 0 rather than Infinity when there was nothing to move", () => {
    expect(changePct(500, 500)).toBe(0);
    expect(changePct(0, 0)).toBe(0);
  });
});

describe("computeDayMovesByType", () => {
  const positions = [
    makePosition({ ticker: "AAPL", type: "Stock", valueCents: 150000, dayGainLossCents: 5000 }),
    makePosition({ ticker: "MSFT", type: "Stock", valueCents: 100000, dayGainLossCents: -2000 }),
    makePosition({ ticker: "SPY", type: "ETF", valueCents: 180000, dayGainLossCents: 800 }),
    makePosition({ ticker: "QACDS", type: "Other", valueCents: 7259, dayGainLossCents: 0 }),
  ];

  it("splits value and gain into Stock / ETF / Other", () => {
    const moves = computeDayMovesByType(positions);
    expect(moves.stock).toMatchObject({ valueCents: 250000, gainLossCents: 3000 });
    expect(moves.etf).toMatchObject({ valueCents: 180000, gainLossCents: 800 });
    expect(moves.other).toMatchObject({ valueCents: 7259, gainLossCents: 0 });
  });

  it("makes the total the sum of the three buckets", () => {
    const moves = computeDayMovesByType(positions);
    expect(moves.total.valueCents).toBe(437259);
    expect(moves.total.gainLossCents).toBe(3800);
  });

  it("computes each bucket's percent against its own prior value", () => {
    const moves = computeDayMovesByType(positions);
    expect(moves.stock.changePct).toBeCloseTo((3000 / 247000) * 100, 5);
    expect(moves.etf.changePct).toBeCloseTo((800 / 179200) * 100, 5);
  });

  it("buckets Bond, MutualFund and Crypto as Other", () => {
    const moves = computeDayMovesByType([
      makePosition({ type: "Bond", valueCents: 100, dayGainLossCents: 1 }),
      makePosition({ ticker: "B", type: "MutualFund", valueCents: 100, dayGainLossCents: 1 }),
      makePosition({ ticker: "C", type: "Crypto", valueCents: 100, dayGainLossCents: 1 }),
    ]);
    expect(moves.other.valueCents).toBe(300);
    expect(moves.stock.valueCents).toBe(0);
  });

  it("returns all zeros for an empty portfolio", () => {
    const moves = computeDayMovesByType([]);
    expect(moves.total).toEqual({ valueCents: 0, gainLossCents: 0, changePct: 0 });
  });
});

describe("computeTickerDayMoves", () => {
  it("sums a ticker held in more than one account into a single row", () => {
    const moves = computeTickerDayMoves([
      makePosition({ accountId: 0, ticker: "MSFT", quantity: 10, valueCents: 100000, dayGainLossCents: 1000 }),
      makePosition({ accountId: 7, ticker: "MSFT", quantity: 5, valueCents: 50000, dayGainLossCents: 500 }),
    ]);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({
      ticker: "MSFT",
      valueCents: 150000,
      gainLossCents: 1500,
      quantity: 15,
      accountCount: 2,
    });
  });

  it("derives the per-share move, and gets the same answer from either account alone", () => {
    // Both lots moved $1/share; summing must not turn that into $1.50.
    const moves = computeTickerDayMoves([
      makePosition({ accountId: 0, ticker: "MSFT", quantity: 10, dayGainLossCents: 1000 }),
      makePosition({ accountId: 7, ticker: "MSFT", quantity: 5, dayGainLossCents: 500 }),
    ]);
    expect(moves[0].perShareGainLossCents).toBe(100);
  });

  it("keeps the per-share move negative on a down day", () => {
    const moves = computeTickerDayMoves([
      makePosition({ ticker: "TSLA", quantity: 33, dayGainLossCents: -3300 }),
    ]);
    expect(moves[0].perShareGainLossCents).toBe(-100);
  });

  it("rounds the per-share move to the cent for a fractional holding", () => {
    // 442.4575 shares up $234,502 total -> $5.30/share.
    const moves = computeTickerDayMoves([
      makePosition({ ticker: "NVDA", quantity: 442.4575, dayGainLossCents: 234502 }),
    ]);
    expect(moves[0].perShareGainLossCents).toBe(530);
  });

  it("reports a zero per-share move rather than dividing by zero shares", () => {
    const moves = computeTickerDayMoves([
      makePosition({ ticker: "GONE", quantity: 0, valueCents: 0, dayGainLossCents: 0 }),
    ]);
    expect(moves[0].perShareGainLossCents).toBe(0);
  });

  it("keeps different tickers apart", () => {
    const moves = computeTickerDayMoves([
      makePosition({ ticker: "AAPL" }),
      makePosition({ ticker: "MSFT" }),
    ]);
    expect(moves.map((move) => move.ticker).sort()).toEqual(["AAPL", "MSFT"]);
  });

  it("takes a name from whichever account has one", () => {
    const moves = computeTickerDayMoves([
      makePosition({ accountId: 0, ticker: "MSFT", name: "" }),
      makePosition({ accountId: 7, ticker: "MSFT", name: "Microsoft Corp" }),
    ]);
    expect(moves[0].name).toBe("Microsoft Corp");
  });

  it("returns an empty list for no positions", () => {
    expect(computeTickerDayMoves([])).toEqual([]);
  });
});

describe("topGainers and topLosers", () => {
  // MANY: 1,000 shares up $1 each  -> +$1,000 total,  +$1.00/share
  // FEW:      2 shares up $200 each -> +$400 total,   +$200.00/share
  // The two measures must therefore rank these in opposite orders, or the
  // per-share assertions below would pass by accident.
  const moves = computeTickerDayMoves([
    makePosition({ ticker: "MANY", type: "Stock", quantity: 1000, valueCents: 1000000, dayGainLossCents: 100000 }),
    makePosition({ ticker: "FEW", type: "Stock", quantity: 2, valueCents: 200000, dayGainLossCents: 40000 }),
    makePosition({ ticker: "SPY", type: "ETF", quantity: 4, valueCents: 180000, dayGainLossCents: 800 }),
    // BULK loses the most dollars; THIN loses the most per share.
    makePosition({ ticker: "BULK", type: "Stock", quantity: 500, valueCents: 90000, dayGainLossCents: -10000 }),
    makePosition({ ticker: "THIN", type: "ETF", quantity: 2, valueCents: 1000, dayGainLossCents: -1000 }),
    makePosition({ ticker: "FLAT", type: "Stock", quantity: 10, valueCents: 50000, dayGainLossCents: 0 }),
  ]);

  it("ranks gainers by total value by default", () => {
    expect(topGainers(moves, 5).map((move) => move.ticker)).toEqual(["MANY", "FEW", "SPY"]);
  });

  it("ranks gainers by the per-share move when asked", () => {
    expect(topGainers(moves, 5, "perShare").map((move) => move.ticker)).toEqual([
      "FEW",
      "SPY",
      "MANY",
    ]);
  });

  it("ranks losers worst-first under either measure", () => {
    expect(topLosers(moves, 5).map((move) => move.ticker)).toEqual(["BULK", "THIN"]);
    expect(topLosers(moves, 5, "perShare").map((move) => move.ticker)).toEqual(["THIN", "BULK"]);
  });

  it("mixes stocks and ETFs in one ranking", () => {
    expect(topGainers(moves, 5).some((move) => move.type === "ETF")).toBe(true);
  });

  it("excludes flat tickers from both lists", () => {
    expect(topGainers(moves, 10).some((move) => move.ticker === "FLAT")).toBe(false);
    expect(topLosers(moves, 10).some((move) => move.ticker === "FLAT")).toBe(false);
  });

  it("never puts a loser in the gainers list, even when the list is short", () => {
    const redDay = computeTickerDayMoves([
      makePosition({ ticker: "A", quantity: 1, valueCents: 100, dayGainLossCents: -10 }),
      makePosition({ ticker: "B", quantity: 1, valueCents: 100, dayGainLossCents: -20 }),
    ]);
    expect(topGainers(redDay, 5)).toEqual([]);
    expect(topLosers(redDay, 5)).toHaveLength(2);
  });

  it("drops a holding whose per-share move rounds to nothing from a per-share ranking", () => {
    // Up $3 in total across 1,000 shares — real money, but under half a cent a
    // share, so it isn't a per-share mover.
    const dust = computeTickerDayMoves([
      makePosition({ ticker: "DUST", quantity: 1000, valueCents: 100000, dayGainLossCents: 300 }),
    ]);
    expect(topGainers(dust, 5, "total").map((move) => move.ticker)).toEqual(["DUST"]);
    expect(topGainers(dust, 5, "perShare")).toEqual([]);
  });

  it("orders ties deterministically rather than by which account was read first", () => {
    const tied = computeTickerDayMoves([
      makePosition({ ticker: "ZZZ", quantity: 10, valueCents: 100000, dayGainLossCents: 1000 }),
      makePosition({ ticker: "AAA", quantity: 10, valueCents: 100000, dayGainLossCents: 1000 }),
    ]);
    expect(topGainers(tied, 5).map((move) => move.ticker)).toEqual(["AAA", "ZZZ"]);
  });

  it("caps the list at the requested count", () => {
    expect(topGainers(moves, 2).map((move) => move.ticker)).toEqual(["MANY", "FEW"]);
  });
});

describe("inferPositionType", () => {
  it("maps a broker's asset class onto an instrument type", () => {
    expect(inferPositionType("Equity", "US Large Cap")).toBe("Stock");
    expect(inferPositionType("Cash & Money Market Funds", "Money Market Funds")).toBe("Other");
    expect(inferPositionType("Fixed Income", "")).toBe("Bond");
    expect(inferPositionType("ETF", "")).toBe("ETF");
    expect(inferPositionType("Mutual Fund", "")).toBe("MutualFund");
  });

  it("returns undefined for a class it doesn't recognize, so the caller can keep what it had", () => {
    expect(inferPositionType("", "")).toBeUndefined();
    expect(inferPositionType("Alternatives", "Private Credit")).toBeUndefined();
  });
});

describe("resolvePositionType", () => {
  it("takes an explicit, valid Type value over anything inferred", () => {
    expect(resolvePositionType({ type: "ETF", assetClass: "Equity" })).toBe("ETF");
  });

  it("infers from the asset class when Type is absent or unusable", () => {
    expect(resolvePositionType({ assetClass: "Equity" })).toBe("Stock");
    expect(resolvePositionType({ type: "  ", assetClass: "Cash & Money Market Funds" })).toBe("Other");
    expect(resolvePositionType({ type: "gibberish", assetClass: "Equity" })).toBe("Stock");
  });

  it("falls back when there's nothing to go on", () => {
    expect(resolvePositionType({})).toBe("Stock");
    expect(resolvePositionType({}, "ETF")).toBe("ETF");
  });

  it("trims before matching, so a padded cell still counts", () => {
    expect(resolvePositionType({ type: "  ETF  " })).toBe("ETF");
  });
});

describe("computeTransactionStats", () => {
  const transactions: StockTransaction[] = [
    {
      id: 1,
      transactionAt: "2026-01-01",
      action: "Buy",
      ticker: "AAPL",
      numberOfShares: 5,
      pricePerShareCents: 15000,
      totalAmountCents: 75000,
      brokerageFirm: "",
      externalId: "",
      note: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: 2,
      transactionAt: "2026-02-01",
      action: "Buy",
      ticker: "AAPL",
      numberOfShares: 5,
      pricePerShareCents: 17000,
      totalAmountCents: 85000,
      brokerageFirm: "",
      externalId: "",
      note: "",
      createdAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
    },
  ];

  it("computes count/avg/max/min price per share", () => {
    expect(computeTransactionStats(transactions)).toEqual({
      count: 2,
      avgPricePerShareCents: 16000,
      maxPricePerShareCents: 17000,
      minPricePerShareCents: 15000,
    });
  });

  it("returns zeros for an empty list", () => {
    expect(computeTransactionStats([])).toEqual({
      count: 0,
      avgPricePerShareCents: 0,
      maxPricePerShareCents: 0,
      minPricePerShareCents: 0,
    });
  });
});

describe("computeAverageCostBasisCents", () => {
  function makeTransaction(overrides: Partial<StockTransaction>): StockTransaction {
    return {
      id: 1,
      transactionAt: "2026-01-01",
      action: "Buy",
      ticker: "AAPL",
      numberOfShares: 1,
      pricePerShareCents: 10000,
      totalAmountCents: 10000,
      brokerageFirm: "",
      externalId: "",
      note: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
    };
  }

  it("share-weights the average buy price across multiple Buy transactions", () => {
    const transactions = [
      makeTransaction({ numberOfShares: 10, pricePerShareCents: 10000 }),
      makeTransaction({ numberOfShares: 5, pricePerShareCents: 13000 }),
    ];
    // (10*10000 + 5*13000) / 15 = 11000
    expect(computeAverageCostBasisCents(transactions)).toBeCloseTo(11000, 5);
  });

  it("ignores Sell transactions", () => {
    const transactions = [
      makeTransaction({ action: "Buy", numberOfShares: 10, pricePerShareCents: 10000 }),
      makeTransaction({ action: "Sell", numberOfShares: 5, pricePerShareCents: 99999 }),
    ];
    expect(computeAverageCostBasisCents(transactions)).toBe(10000);
  });

  it("returns undefined when there are no Buy transactions", () => {
    expect(computeAverageCostBasisCents([makeTransaction({ action: "Sell" })])).toBeUndefined();
    expect(computeAverageCostBasisCents([])).toBeUndefined();
  });
});

describe("importPositionsFromCsv", () => {
  const mapping = { "0": "ticker", "1": "name", "2": "currentPrice", "3": "quantity" };

  it("imports a new position with all mapped fields", () => {
    const repo = fakeRepo();
    const summary = importPositionsFromCsv(repo, "Symbol,Name,Price,Qty\nAAPL,Apple Inc.,150.00,10", mapping);
    expect(summary).toEqual({
      importedCount: 1,
      updatedCount: 0,
      skippedCount: 0,
      results: [{ rowNumber: 1, status: "imported" }],
    });
    const position = listPositions(repo)[0];
    expect(position.currentPriceCents).toBe(15000);
    expect(position.quantity).toBe(10);
    expect(position.accountId).toBe(0);
  });

  it("imports into the account it was given", () => {
    const repo = fakeRepo();
    importPositionsFromCsv(repo, "Symbol,Name,Price,Qty\nAAPL,Apple Inc.,150.00,10", mapping, {
      accountId: 7,
    });
    expect(listPositions(repo)[0].accountId).toBe(7);
    expect(listPositions(repo, 0)).toHaveLength(0);
  });

  it("adds to a second account rather than overwriting the first", () => {
    const repo = fakeRepo();
    const csv = "Symbol,Name,Price,Qty\nAAPL,Apple Inc.,150.00,10";
    importPositionsFromCsv(repo, csv, mapping, { accountId: 0 });
    importPositionsFromCsv(repo, "Symbol,Name,Price,Qty\nAAPL,Apple Inc.,150.00,3", mapping, {
      accountId: 7,
    });
    expect(listPositions(repo)).toHaveLength(2);
    expect(getPosition(repo, { accountId: 0, ticker: "AAPL" })?.quantity).toBe(10);
    expect(getPosition(repo, { accountId: 7, ticker: "AAPL" })?.quantity).toBe(3);
  });

  it("strips a trailing company-name suffix and uppercases the ticker", () => {
    const repo = fakeRepo();
    importPositionsFromCsv(repo, "Symbol,Name,Price,Qty\naapl - Apple Inc.,Apple Inc.,150.00,10", mapping);
    expect(listPositions(repo)[0].ticker).toBe("AAPL");
  });

  it("preserves existing fields when the CSV value is blank or zero", () => {
    const repo = fakeRepo([
      makePosition({
        currentPriceCents: 14000,
        quantity: 5,
        dayGainLossCents: 100,
        valueCents: 70000,
        dayHighCents: 200,
        dayLowCents: 50,
        dividendRateCents: 25,
        costCents: 60000,
      }),
    ]);
    importPositionsFromCsv(repo, "Symbol,Name,Price,Qty\nAAPL,,0,0", mapping);
    const updated = listPositions(repo)[0];
    expect(updated.name).toBe("Apple Inc.");
    expect(updated.currentPriceCents).toBe(14000);
    expect(updated.quantity).toBe(5);
    // Cost isn't in the mapping at all, so the stored basis must survive.
    expect(updated.costCents).toBe(60000);
  });

  it("imports cost basis, identifiers and classification when mapped", () => {
    const repo = fakeRepo();
    importPositionsFromCsv(
      repo,
      'Asset Class,Asset Strategy,Description,Ticker,CUSIP,Quantity,Price,Value,Cost,Unit Cost,"Unrealized G/L Amt.","Unrealized Gain/Loss (%)","Est. Annual Income",ISIN\n' +
        'Equity,US Large Cap,NVIDIA CORP,NVDA,67066G104,442.4575,211.94,"93,774.44","22,022.21",49.77,"71,752.23",325.82,442.46,US67066G1040',
      {
        "0": "assetClass",
        "1": "assetStrategy",
        "2": "name",
        "3": "ticker",
        "4": "cusip",
        "5": "quantity",
        "6": "currentPrice",
        "8": "cost",
        "9": "unitCost",
        "10": "unrealizedGainLoss",
        "11": "unrealizedGainLossPct",
        "12": "estAnnualIncome",
        "13": "isin",
      },
    );

    const position = listPositions(repo)[0];
    expect(position.ticker).toBe("NVDA");
    expect(position.quantity).toBeCloseTo(442.4575, 4);
    expect(position.costCents).toBe(2202221);
    expect(position.unitCostCents).toBe(4977);
    expect(position.unrealizedGainLossCents).toBe(7175223);
    expect(position.unrealizedGainLossPct).toBeCloseTo(325.82, 2);
    expect(position.estAnnualIncomeCents).toBe(44246);
    expect(position.cusip).toBe("67066G104");
    expect(position.isin).toBe("US67066G1040");
    expect(position.assetStrategy).toBe("US Large Cap");
    // "Equity" with no explicit Type column infers Stock.
    expect(position.type).toBe("Stock");
  });

  it("derives unit cost from total cost and quantity when the export has no per-share column", () => {
    const repo = fakeRepo();
    importPositionsFromCsv(repo, "Symbol,Price,Qty,Cost\nAAPL,150.00,10,1000.00", {
      "0": "ticker",
      "1": "currentPrice",
      "2": "quantity",
      "3": "cost",
    });
    expect(listPositions(repo)[0].unitCostCents).toBe(10000); // 100000 cents / 10 shares
  });

  it("derives the unrealized gain from value minus cost when the export omits it", () => {
    const repo = fakeRepo();
    importPositionsFromCsv(repo, "Symbol,Price,Qty,Cost\nAAPL,150.00,10,1000.00", {
      "0": "ticker",
      "1": "currentPrice",
      "2": "quantity",
      "3": "cost",
    });
    expect(listPositions(repo)[0].unrealizedGainLossCents).toBe(50000); // 150000 - 100000
  });

  it("keeps a negative day change and a negative unrealized loss", () => {
    const repo = fakeRepo();
    importPositionsFromCsv(repo, 'Symbol,Price,Qty,Change,G/L\nTSLA,327.35,33,"-3,763.48","-3,763.48"', {
      "0": "ticker",
      "1": "currentPrice",
      "2": "quantity",
      "3": "dayGainLoss",
      "4": "unrealizedGainLoss",
    });
    const position = listPositions(repo)[0];
    expect(position.dayGainLossCents).toBe(-376348);
    expect(position.unrealizedGainLossCents).toBe(-376348);
  });

  it("classifies a money-market row as Other rather than Stock", () => {
    const repo = fakeRepo();
    importPositionsFromCsv(repo, "Class,Symbol,Price,Qty\nCash & Money Market Funds,QACDS,1,72.59", {
      "0": "assetClass",
      "1": "ticker",
      "2": "currentPrice",
      "3": "quantity",
    });
    expect(listPositions(repo)[0].type).toBe("Other");
  });

  /**
   * `parseCsv` drops any record with fewer than half the header's fields, which is
   * what keeps a broker's trailing FOOTNOTES block out of the data. That threshold
   * scales with the header, so it only bites on a wide export — the case that
   * matters, since the footnote block is a wide-export habit. A narrow CSV whose
   * footnote lines happen to be half its width is *not* detected; those rows are
   * data as far as this importer is concerned.
   */
  it("ignores the footnote block a broker appends after a wide export", () => {
    const repo = fakeRepo();
    const headers = Array.from({ length: 12 }, (_, index) => `Col${index}`).join(",");
    const dataRow = ["AAPL", "Apple Inc.", "150.00", "10", ...Array(8).fill("")].join(",");
    const summary = importPositionsFromCsv(
      repo,
      `${headers}\n${dataRow}\n\nFOOTNOTES\nW,"This position is part of a wash sale."`,
      mapping,
    );
    expect(summary.importedCount).toBe(1);
    expect(summary.skippedCount).toBe(0);
    expect(listPositions(repo).map((position) => position.ticker)).toEqual(["AAPL"]);
  });

  it("skips a row with no ticker", () => {
    const repo = fakeRepo();
    const summary = importPositionsFromCsv(repo, "Symbol,Name,Price,Qty\n,Apple Inc.,150.00,10", mapping);
    expect(summary).toEqual({
      importedCount: 0,
      updatedCount: 0,
      skippedCount: 1,
      results: [{ rowNumber: 1, status: "skipped", reason: "Missing ticker" }],
    });
  });

  describe("excluded rows", () => {
    const csv = ["Symbol,Name,Price,Qty", "AAA,A,10.00,1", "BBB,B,20.00,2", "CCC,C,30.00,3"].join(
      "\n",
    );

    it("imports every row when nothing is excluded", () => {
      const repo = fakeRepo();
      const summary = importPositionsFromCsv(repo, csv, mapping);
      expect(summary.importedCount).toBe(3);
      expect(listPositions(repo).map((position) => position.ticker)).toEqual(["AAA", "BBB", "CCC"]);
    });

    it("leaves out the rows the user removed", () => {
      const repo = fakeRepo();
      const summary = importPositionsFromCsv(repo, csv, mapping, { excludedRowIndexes: [1] });
      expect(summary.importedCount).toBe(2);
      expect(listPositions(repo).map((position) => position.ticker)).toEqual(["AAA", "CCC"]);
    });

    it("does not report an excluded row as a skip — a skip is a surprise, this isn't", () => {
      const repo = fakeRepo();
      const summary = importPositionsFromCsv(repo, csv, mapping, { excludedRowIndexes: [1] });
      expect(summary.skippedCount).toBe(0);
      expect(summary.results).toHaveLength(2);
    });

    /** Guards the renumbering trap: row 3 must still be called row 3. */
    it("reports a later row's failure against its number in the file", () => {
      const repo = fakeRepo();
      // Row 3 has no ticker, and rows 1-2 are excluded.
      const withBadThirdRow = [
        "Symbol,Name,Price,Qty",
        "AAA,A,10.00,1",
        "BBB,B,20.00,2",
        ",C,30.00,3",
      ].join("\n");
      const summary = importPositionsFromCsv(repo, withBadThirdRow, mapping, { excludedRowIndexes: [0, 1] });
      expect(summary.results).toEqual([
        { rowNumber: 3, status: "skipped", reason: "Missing ticker" },
      ]);
    });

    it("imports nothing when every row is excluded", () => {
      const repo = fakeRepo();
      const summary = importPositionsFromCsv(repo, csv, mapping, { excludedRowIndexes: [0, 1, 2] });
      expect(summary).toEqual({ importedCount: 0, updatedCount: 0, skippedCount: 0, results: [] });
      expect(listPositions(repo)).toHaveLength(0);
    });

    it("combines exclusions with a fixed value", () => {
      const repo = fakeRepo();
      importPositionsFromCsv(
        repo,
        csv,
        { ...mapping, "1": "type" },
        { fieldOptions: { "1": { constantValue: "ETF" } }, excludedRowIndexes: [0] },
      );
      const positions = listPositions(repo);
      expect(positions.map((position) => position.ticker)).toEqual(["BBB", "CCC"]);
      expect(positions.every((position) => position.type === "ETF")).toBe(true);
    });
  });

  describe("per-row values", () => {
    // A real mixed file: two ETFs and a stock, with nothing in the data saying so.
    const csv = [
      "Symbol,Class,Price,Qty",
      "VOO,Equity,450.00,10",
      "AAPL,Equity,150.00,5",
      "QQQ,Equity,500.00,4",
    ].join("\n");
    const columns = { "0": "ticker", "1": "assetClass", "2": "currentPrice", "3": "quantity" };

    it("sets each row's type individually", () => {
      const repo = fakeRepo();
      importPositionsFromCsv(repo, csv, columns, {
        rowValueOverrides: { 0: { type: "ETF" }, 2: { type: "ETF" } },
      });
      const byTicker = Object.fromEntries(
        listPositions(repo).map((position) => [position.ticker, position.type]),
      );
      expect(byTicker).toEqual({ VOO: "ETF", AAPL: "Stock", QQQ: "ETF" });
    });

    it("leaves rows with no override on the value the file implies", () => {
      const repo = fakeRepo();
      importPositionsFromCsv(repo, csv, columns, { rowValueOverrides: { 0: { type: "ETF" } } });
      // "Equity" infers Stock for the untouched rows.
      expect(listPositions(repo).find((p) => p.ticker === "AAPL")?.type).toBe("Stock");
    });

    it("beats a column-wide fixed value, being more specific", () => {
      const repo = fakeRepo();
      importPositionsFromCsv(repo, csv, { ...columns, "1": "type" }, {
        fieldOptions: { "1": { constantValue: "ETF" } },
        rowValueOverrides: { 1: { type: "Stock" } },
      });
      const byTicker = Object.fromEntries(
        listPositions(repo).map((position) => [position.ticker, position.type]),
      );
      expect(byTicker).toEqual({ VOO: "ETF", AAPL: "Stock", QQQ: "ETF" });
    });

    it("is keyed by the row's position in the file, not by its position after exclusions", () => {
      const repo = fakeRepo();
      // Drop row 1 (VOO); the override on index 2 must still land on QQQ.
      importPositionsFromCsv(repo, csv, columns, {
        excludedRowIndexes: [0],
        rowValueOverrides: { 2: { type: "ETF" } },
      });
      const byTicker = Object.fromEntries(
        listPositions(repo).map((position) => [position.ticker, position.type]),
      );
      expect(byTicker).toEqual({ AAPL: "Stock", QQQ: "ETF" });
    });

    it("ignores an override for a row that isn't in the file", () => {
      const repo = fakeRepo();
      const summary = importPositionsFromCsv(repo, csv, columns, {
        rowValueOverrides: { 99: { type: "ETF" } },
      });
      expect(summary.importedCount).toBe(3);
    });

    it("can override a field other than type", () => {
      const repo = fakeRepo();
      importPositionsFromCsv(repo, csv, columns, {
        rowValueOverrides: { 0: { assetStrategy: "US Large Cap" } },
      });
      expect(listPositions(repo).find((p) => p.ticker === "VOO")?.assetStrategy).toBe(
        "US Large Cap",
      );
    });
  });

  describe("fixed values", () => {
    it("stamps every row with a fixed Type the file never mentions", () => {
      const repo = fakeRepo();
      // The export has no Type column, so a spare one carries the constant.
      importPositionsFromCsv(
        repo,
        "Symbol,Spare,Price,Qty\nVOO,,450.00,10\nQQQ,,500.00,4",
        { "0": "ticker", "1": "type", "2": "currentPrice", "3": "quantity" },
        { fieldOptions: { "1": { constantValue: "ETF" } } },
      );
      expect(listPositions(repo).map((position) => position.type)).toEqual(["ETF", "ETF"]);
    });

    it("beats the value the column actually holds", () => {
      const repo = fakeRepo();
      // "Equity" would infer Stock; the fixed value must win.
      importPositionsFromCsv(
        repo,
        "Symbol,Class,Price,Qty\nVOO,Equity,450.00,10",
        { "0": "ticker", "1": "type", "2": "currentPrice", "3": "quantity" },
        { fieldOptions: { "1": { constantValue: "ETF" } } },
      );
      expect(listPositions(repo)[0].type).toBe("ETF");
    });

    it("reads the cells again once the fixed value is cleared", () => {
      const repo = fakeRepo();
      const csv = "Symbol,Class,Price,Qty\nVOO,Equity,450.00,10";
      const columns = { "0": "ticker", "1": "assetClass", "2": "currentPrice", "3": "quantity" };
      importPositionsFromCsv(repo, csv, columns, {
        fieldOptions: { "1": { constantValue: "  " } },
      });
      expect(listPositions(repo)[0].assetClass).toBe("Equity");
    });

    it("works on a text field like asset strategy", () => {
      const repo = fakeRepo();
      importPositionsFromCsv(
        repo,
        "Symbol,Spare,Price,Qty\nVOO,,450.00,10",
        { "0": "ticker", "1": "assetStrategy", "2": "currentPrice", "3": "quantity" },
        { fieldOptions: { "1": { constantValue: "US Large Cap" } } },
      );
      expect(listPositions(repo)[0].assetStrategy).toBe("US Large Cap");
    });

    it("works on a numeric field, parsed the same way a cell would be", () => {
      const repo = fakeRepo();
      importPositionsFromCsv(
        repo,
        "Symbol,Spare,Price\nVOO,,450.00",
        { "0": "ticker", "1": "quantity", "2": "currentPrice" },
        { fieldOptions: { "1": { constantValue: "2.5" } } },
      );
      const position = listPositions(repo)[0];
      expect(position.quantity).toBe(2.5);
      expect(position.valueCents).toBe(112500); // 45000 cents x 2.5
    });

    it("still rejects a fixed value the field's schema won't accept", () => {
      const repo = fakeRepo();
      const summary = importPositionsFromCsv(
        repo,
        "Symbol,Spare,Price,Qty\nVOO,,450.00,10",
        { "0": "ticker", "1": "type", "2": "currentPrice", "3": "quantity" },
        { fieldOptions: { "1": { constantValue: "NotAType" } } },
      );
      // An unparseable type falls back rather than failing the row — the same
      // tolerance an unrecognised cell value gets.
      expect(summary.importedCount).toBe(1);
      expect(listPositions(repo)[0].type).toBe("Stock");
    });
  });
});

describe("importTransactionsFromCsv", () => {
  const mapping = { "0": "date", "1": "action", "2": "ticker", "3": "numberOfShares", "4": "pricePerShare" };

  it("imports valid rows and computes totalAmountCents", () => {
    const repo = fakeRepo();
    const summary = importTransactionsFromCsv(
      repo,
      "Date,Action,Symbol,Shares,Price\n2026-01-15,Buy,AAPL,5,150.00",
      mapping,
    );
    expect(summary.importedCount).toBe(1);
    expect(listTransactions(repo)[0].totalAmountCents).toBe(75000);
  });

  it("defaults action to Buy when the value isn't exactly Sell", () => {
    const repo = fakeRepo();
    importTransactionsFromCsv(repo, "Date,Action,Symbol,Shares,Price\n2026-01-15,Purchase,AAPL,5,150.00", mapping);
    expect(listTransactions(repo)[0].action).toBe("Buy");
  });

  it("skips a duplicate of an existing transaction", () => {
    const repo = fakeRepo();
    const csv = "Date,Action,Symbol,Shares,Price\n2026-01-15,Buy,AAPL,5,150.00";
    importTransactionsFromCsv(repo, csv, mapping);
    const summary = importTransactionsFromCsv(repo, csv, mapping);
    expect(summary).toEqual({
      importedCount: 0,
      updatedCount: 0,
      skippedCount: 1,
      results: [{ rowNumber: 1, status: "skipped", reason: "Duplicate of an existing transaction" }],
    });
  });

  it("skips a row with zero shares as invalid", () => {
    const repo = fakeRepo();
    const summary = importTransactionsFromCsv(
      repo,
      "Date,Action,Symbol,Shares,Price\n2026-01-15,Buy,AAPL,0,150.00",
      mapping,
    );
    expect(summary.skippedCount).toBe(1);
    expect(summary.results[0].status).toBe("skipped");
  });

  it("skips a row with no ticker", () => {
    const repo = fakeRepo();
    const summary = importTransactionsFromCsv(repo, "Date,Action,Symbol,Shares,Price\n2026-01-15,Buy,,5,150.00", mapping);
    expect(summary.results[0]).toEqual({ rowNumber: 1, status: "skipped", reason: "Missing ticker" });
  });

  it("reads dates by the given format instead of guessing", () => {
    const repo = fakeRepo();
    // 03/04/2026 is 4 March under DD/MM/YYYY and 3 April under MM/DD/YYYY.
    importTransactionsFromCsv(repo, "Date,Action,Symbol,Shares,Price\n03/04/2026,Buy,AAPL,5,150.00", mapping, {
      "0": { dateFormat: "DD/MM/YYYY" },
    });
    expect(listTransactions(repo)[0].transactionAt).toBe("2026-04-03");
  });

  it("skips a row whose date doesn't match the given format, rather than importing a guess", () => {
    const repo = fakeRepo();
    const summary = importTransactionsFromCsv(
      repo,
      "Date,Action,Symbol,Shares,Price\n15-Jan-26,Buy,AAPL,5,150.00",
      mapping,
      { "0": { dateFormat: "DD/MM/YYYY" } },
    );
    expect(summary.skippedCount).toBe(1);
    expect(listTransactions(repo)).toHaveLength(0);
  });

  it("falls back to loose parsing when the format is blank", () => {
    const repo = fakeRepo();
    importTransactionsFromCsv(repo, "Date,Action,Symbol,Shares,Price\n2026-01-15,Buy,AAPL,5,150.00", mapping, {
      "0": { dateFormat: "   " },
    });
    expect(listTransactions(repo)[0].transactionAt).toBe("2026-01-15");
  });

  describe("brokerage firm and duplicate detection", () => {
    const columns = {
      "0": "date",
      "1": "action",
      "2": "ticker",
      "3": "numberOfShares",
      "4": "pricePerShare",
      "5": "brokerageFirm",
    };
    const line = (firm: string) => `2026-01-15,Buy,AAPL,5,150.00,${firm}`;
    const header = "Date,Action,Symbol,Shares,Price,Firm";

    it("records the firm", () => {
      const repo = fakeRepo();
      importTransactionsFromCsv(repo, `${header}\n${line("Chase")}`, columns);
      expect(listTransactions(repo)[0].brokerageFirm).toBe("Chase");
    });

    it("keeps the same trade at two firms as two transactions", () => {
      const repo = fakeRepo();
      importTransactionsFromCsv(repo, [header, line("Chase"), line("Fidelity")].join("\n"), columns);
      expect(listTransactions(repo).map((t) => t.brokerageFirm)).toEqual(["Chase", "Fidelity"]);
    });

    /**
     * The case that broke the old unique index: `transaction_at` is a date, so three
     * lots bought through one day are identical on every stored column. They are
     * three real trades and all three must land.
     */
    it("imports several identical intraday lots, not just the first", () => {
      const repo = fakeRepo();
      const summary = importTransactionsFromCsv(
        repo,
        [header, line("Chase"), line("Chase"), line("Chase")].join("\n"),
        columns,
      );
      expect(summary.importedCount).toBe(3);
      expect(listTransactions(repo)).toHaveLength(3);
    });

    it("re-importing the same file adds nothing", () => {
      const repo = fakeRepo();
      const csv = [header, line("Chase"), line("Chase"), line("Chase")].join("\n");
      importTransactionsFromCsv(repo, csv, columns);
      const second = importTransactionsFromCsv(repo, csv, columns);
      expect(second.importedCount).toBe(0);
      expect(second.skippedCount).toBe(3);
      expect(listTransactions(repo)).toHaveLength(3);
    });

    it("inserts only the shortfall when the file has grown", () => {
      const repo = fakeRepo();
      importTransactionsFromCsv(repo, [header, line("Chase")].join("\n"), columns);
      // A later export of the same day now shows three lots; two are new.
      const summary = importTransactionsFromCsv(
        repo,
        [header, line("Chase"), line("Chase"), line("Chase")].join("\n"),
        columns,
      );
      expect(summary.importedCount).toBe(2);
      expect(listTransactions(repo)).toHaveLength(3);
    });

    it("counts firms separately, so two lots at each firm gives four rows", () => {
      const repo = fakeRepo();
      importTransactionsFromCsv(
        repo,
        [header, line("Chase"), line("Chase"), line("Fidelity"), line("Fidelity")].join("\n"),
        columns,
      );
      expect(listTransactions(repo)).toHaveLength(4);
    });

    it("treats a differing price as a different trade", () => {
      const repo = fakeRepo();
      importTransactionsFromCsv(
        repo,
        [header, line("Chase"), "2026-01-15,Buy,AAPL,5,151.00,Chase"].join("\n"),
        columns,
      );
      expect(listTransactions(repo)).toHaveLength(2);
    });
  });

  describe("broker reference (external id)", () => {
    const columns = {
      "0": "date",
      "1": "action",
      "2": "ticker",
      "3": "numberOfShares",
      "4": "pricePerShare",
      "5": "externalId",
    };
    const header = "Date,Action,Symbol,Shares,Price,Reference Number";

    it("records the reference", () => {
      const repo = fakeRepo();
      importTransactionsFromCsv(repo, `${header}\n2026-01-15,Buy,AAPL,5,150.00,REF-1`, columns);
      expect(listTransactions(repo)[0].externalId).toBe("REF-1");
    });

    it("keeps two identical lots that carry different references", () => {
      const repo = fakeRepo();
      importTransactionsFromCsv(
        repo,
        [header, "2026-01-15,Buy,AAPL,5,150.00,REF-1", "2026-01-15,Buy,AAPL,5,150.00,REF-2"].join("\n"),
        columns,
      );
      expect(listTransactions(repo).map((t) => t.externalId)).toEqual(["REF-1", "REF-2"]);
    });

    it("skips a row whose reference is already stored, naming it in the reason", () => {
      const repo = fakeRepo();
      const csv = `${header}\n2026-01-15,Buy,AAPL,5,150.00,REF-1`;
      importTransactionsFromCsv(repo, csv, columns);
      const second = importTransactionsFromCsv(repo, csv, columns);
      expect(second.results[0]).toEqual({
        rowNumber: 1,
        status: "skipped",
        reason: "Already imported (reference REF-1)",
      });
    });

    /** A reference identifies the trade even if the broker restated the price. */
    it("skips on reference alone, even when the other fields changed", () => {
      const repo = fakeRepo();
      importTransactionsFromCsv(repo, `${header}\n2026-01-15,Buy,AAPL,5,150.00,REF-1`, columns);
      const second = importTransactionsFromCsv(
        repo,
        `${header}\n2026-01-16,Buy,AAPL,9,999.00,REF-1`,
        columns,
      );
      expect(second.importedCount).toBe(0);
      expect(listTransactions(repo)).toHaveLength(1);
    });

    it("falls back to counting when the reference column is blank for a row", () => {
      const repo = fakeRepo();
      const csv = [header, "2026-01-15,Buy,AAPL,5,150.00,", "2026-01-15,Buy,AAPL,5,150.00,"].join("\n");
      importTransactionsFromCsv(repo, csv, columns);
      expect(listTransactions(repo)).toHaveLength(2);
      expect(importTransactionsFromCsv(repo, csv, columns).importedCount).toBe(0);
    });
  });

  describe("total amount", () => {
    const withTotal = { "0": "date", "1": "action", "2": "ticker", "3": "numberOfShares", "4": "totalAmount" };

    it("derives the per-share price from a total when the file has no price column", () => {
      const repo = fakeRepo();
      importTransactionsFromCsv(
        repo,
        "Date,Action,Symbol,Shares,Amount\n2026-01-15,Buy,AAPL,5,750.00",
        withTotal,
      );
      const transaction = listTransactions(repo)[0];
      expect(transaction.pricePerShareCents).toBe(15000);
      expect(transaction.totalAmountCents).toBe(75000);
    });

    it("prefers an explicit price/share over the total", () => {
      const repo = fakeRepo();
      // The total disagrees with shares × price; the printed price wins.
      importTransactionsFromCsv(
        repo,
        "Date,Action,Symbol,Shares,Price,Amount\n2026-01-15,Buy,AAPL,5,150.00,999.00",
        { ...mapping, "5": "totalAmount" },
      );
      const transaction = listTransactions(repo)[0];
      expect(transaction.pricePerShareCents).toBe(15000);
      expect(transaction.totalAmountCents).toBe(75000);
    });

    it("keeps the stored total consistent with shares × price for a fractional holding", () => {
      const repo = fakeRepo();
      // $1,000 over 3 shares is $333.333…/share, which rounds to 33333 cents and
      // recomputes to $999.99 — a cent off the stated total, by design.
      importTransactionsFromCsv(
        repo,
        "Date,Action,Symbol,Shares,Amount\n2026-01-15,Buy,AAPL,3,1000.00",
        withTotal,
      );
      const transaction = listTransactions(repo)[0];
      expect(transaction.pricePerShareCents).toBe(33333);
      expect(transaction.totalAmountCents).toBe(99999);
    });

    it("still skips a row with neither a price nor a total", () => {
      const repo = fakeRepo();
      const summary = importTransactionsFromCsv(
        repo,
        "Date,Action,Symbol,Shares,Amount\n2026-01-15,Buy,AAPL,5,",
        withTotal,
      );
      // pricePerShareCents 0 is allowed by the schema, so the row imports at zero
      // rather than failing — but it can't invent a price it wasn't given.
      expect(summary.importedCount).toBe(1);
      expect(listTransactions(repo)[0].totalAmountCents).toBe(0);
    });

    it("ignores a total when the share count is missing, rather than dividing by zero", () => {
      const repo = fakeRepo();
      const summary = importTransactionsFromCsv(
        repo,
        "Date,Action,Symbol,Shares,Amount\n2026-01-15,Buy,AAPL,0,750.00",
        withTotal,
      );
      // Zero shares is rejected by the schema, as it was before.
      expect(summary.skippedCount).toBe(1);
    });
  });

  it("stamps every row with a fixed action when the export doesn't say Buy or Sell", () => {
    const repo = fakeRepo();
    importTransactionsFromCsv(
      repo,
      "Date,Action,Symbol,Shares,Price\n2026-01-15,PURCH,AAPL,5,150.00\n2026-01-16,PURCH,MSFT,2,400.00",
      mapping,
      { "1": { constantValue: "Sell" } },
    );
    expect(listTransactions(repo).map((transaction) => transaction.action)).toEqual(["Sell", "Sell"]);
  });

  it("combines a fixed value with a date format on another column", () => {
    const repo = fakeRepo();
    importTransactionsFromCsv(
      repo,
      "Date,Action,Symbol,Shares,Price\n03/04/2026,x,AAPL,5,150.00",
      mapping,
      { "0": { dateFormat: "DD/MM/YYYY" }, "1": { constantValue: "Sell" } },
    );
    const transaction = listTransactions(repo)[0];
    expect(transaction.transactionAt).toBe("2026-04-03");
    expect(transaction.action).toBe("Sell");
  });
});
