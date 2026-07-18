import { describe, expect, it } from "vitest";
import type { MarketDataClient, Quote } from "@/lib/market-data";
import {
  computeAverageCostBasisCents,
  computePortfolioSummary,
  computeTransactionStats,
  createTransaction,
  deletePosition,
  deleteTransaction,
  importPositionsFromCsv,
  importTransactionsFromCsv,
  listPositions,
  listTransactions,
  refreshAllPositions,
  refreshPosition,
  updateTransaction,
  upsertPosition,
} from "./stock-positions";
import type { StockPositionRepository } from "./ports";
import type { CreateTransactionInput, UpsertPositionInput } from "./schema";
import type { StockPosition, StockTransaction } from "./types";

// Hand-written fake — no mocking framework, reusable across tests.
function fakeRepo(
  seedPositions: StockPosition[] = [],
  seedTransactions: StockTransaction[] = [],
): StockPositionRepository {
  let positions = [...seedPositions];
  let transactions = [...seedTransactions];
  let nextTransactionId = transactions.reduce((max, t) => Math.max(max, t.id), 0) + 1;

  return {
    listPositions() {
      return [...positions];
    },
    getPositionByTicker(ticker) {
      return positions.find((position) => position.ticker === ticker);
    },
    upsertPosition(input, valueCents) {
      const existing = positions.find((position) => position.ticker === input.ticker);
      const saved: StockPosition = {
        ...input,
        valueCents,
        createdAt: existing?.createdAt ?? "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      };
      positions = existing
        ? positions.map((position) => (position.ticker === input.ticker ? saved : position))
        : [...positions, saved];
      return saved;
    },
    deletePosition(ticker) {
      positions = positions.filter((position) => position.ticker !== ticker);
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
    insertTransactionIfNotExists(input, totalAmountCents) {
      const duplicate = transactions.some(
        (transaction) =>
          transaction.transactionAt === input.transactionAt &&
          transaction.action === input.action &&
          transaction.ticker === input.ticker &&
          transaction.totalAmountCents === totalAmountCents,
      );
      if (duplicate) return { inserted: false };

      const created: StockTransaction = {
        id: nextTransactionId++,
        ...input,
        totalAmountCents,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      transactions.push(created);
      return { inserted: true, transaction: created };
    },
    deleteTransaction(id) {
      transactions = transactions.filter((transaction) => transaction.id !== id);
    },
  };
}

describe("upsertPosition", () => {
  const validInput: UpsertPositionInput = {
    ticker: "AAPL",
    name: "Apple Inc.",
    type: "Stock",
    currentPriceCents: 15000,
    quantity: 10,
    dayGainLossCents: 500,
    dayHighCents: 15200,
    dayLowCents: 14800,
    dividendRateCents: 96,
  };

  it("creates a position and computes valueCents server-side", () => {
    const repo = fakeRepo();
    const created = upsertPosition(repo, validInput);
    expect(created.valueCents).toBe(150000);
    expect(listPositions(repo)).toHaveLength(1);
  });

  it("updates an existing position on a repeat call for the same ticker", () => {
    const repo = fakeRepo();
    upsertPosition(repo, validInput);
    const updated = upsertPosition(repo, { ...validInput, currentPriceCents: 16000 });
    expect(updated.valueCents).toBe(160000);
    expect(listPositions(repo)).toHaveLength(1);
  });

  it("rejects an empty ticker", () => {
    const repo = fakeRepo();
    expect(() => upsertPosition(repo, { ...validInput, ticker: "" })).toThrow();
  });

  it("rejects a negative quantity", () => {
    const repo = fakeRepo();
    expect(() => upsertPosition(repo, { ...validInput, quantity: -1 })).toThrow();
  });
});

describe("deletePosition", () => {
  it("removes the position", () => {
    const repo = fakeRepo([
      {
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
      },
    ]);
    deletePosition(repo, "AAPL");
    expect(listPositions(repo)).toHaveLength(0);
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

const seedPosition: StockPosition = {
  ticker: "AAPL",
  name: "Apple Inc.",
  type: "Stock",
  currentPriceCents: 14900,
  quantity: 10,
  dayGainLossCents: 0,
  valueCents: 149000,
  dayHighCents: 15000,
  dayLowCents: 14800,
  dividendRateCents: 90,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

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

    const refreshed = await refreshPosition(repo, client, "AAPL");
    expect(refreshed.currentPriceCents).toBe(15500);
    expect(refreshed.valueCents).toBe(155000);
    expect(refreshed.dayGainLossCents).toBe(5000); // (15500 - 15000) * 10 shares
    expect(refreshed.dividendRateCents).toBe(96);
  });

  it("rejects a ticker with no existing position", async () => {
    const repo = fakeRepo([]);
    const client = fakeMarketDataClient({});
    await expect(refreshPosition(repo, client, "AAPL")).rejects.toThrow();
  });
});

describe("refreshAllPositions", () => {
  it("refreshes every position and tolerates individual failures", async () => {
    const repo = fakeRepo([
      seedPosition,
      { ...seedPosition, ticker: "DELISTED", name: "Delisted Co." },
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
});

describe("createTransaction", () => {
  const validInput: CreateTransactionInput = {
    transactionAt: "2026-01-15",
    action: "Buy",
    ticker: "AAPL",
    numberOfShares: 5,
    pricePerShareCents: 15000,
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
    {
      ticker: "AAPL",
      name: "Apple Inc.",
      type: "Stock",
      currentPriceCents: 15000,
      quantity: 10,
      dayGainLossCents: 500,
      valueCents: 150000,
      dayHighCents: 15200,
      dayLowCents: 14800,
      dividendRateCents: 96,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      ticker: "SPY",
      name: "SPDR S&P 500",
      type: "ETF",
      currentPriceCents: 45000,
      quantity: 4,
      dayGainLossCents: -200,
      valueCents: 180000,
      dayHighCents: 45500,
      dayLowCents: 44500,
      dividendRateCents: 600,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      ticker: "BTC",
      name: "Bitcoin",
      type: "Crypto",
      currentPriceCents: 5000000,
      quantity: 0.1,
      dayGainLossCents: 1000,
      valueCents: 500000,
      dayHighCents: 5100000,
      dayLowCents: 4900000,
      dividendRateCents: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
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
    });
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
    expect(summary).toEqual({ importedCount: 1, skippedCount: 0, results: [{ rowNumber: 1, status: "imported" }] });
    const position = listPositions(repo)[0];
    expect(position.currentPriceCents).toBe(15000);
    expect(position.quantity).toBe(10);
  });

  it("strips a trailing company-name suffix and uppercases the ticker", () => {
    const repo = fakeRepo();
    importPositionsFromCsv(repo, "Symbol,Name,Price,Qty\naapl - Apple Inc.,Apple Inc.,150.00,10", mapping);
    expect(listPositions(repo)[0].ticker).toBe("AAPL");
  });

  it("preserves existing fields when the CSV value is blank or zero", () => {
    const repo = fakeRepo([
      {
        ticker: "AAPL",
        name: "Apple Inc.",
        type: "Stock",
        currentPriceCents: 14000,
        quantity: 5,
        dayGainLossCents: 100,
        valueCents: 70000,
        dayHighCents: 200,
        dayLowCents: 50,
        dividendRateCents: 25,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    importPositionsFromCsv(repo, "Symbol,Name,Price,Qty\nAAPL,,0,0", mapping);
    const updated = listPositions(repo)[0];
    expect(updated.name).toBe("Apple Inc.");
    expect(updated.currentPriceCents).toBe(14000);
    expect(updated.quantity).toBe(5);
  });

  it("skips a row with no ticker", () => {
    const repo = fakeRepo();
    const summary = importPositionsFromCsv(repo, "Symbol,Name,Price,Qty\n,Apple Inc.,150.00,10", mapping);
    expect(summary).toEqual({
      importedCount: 0,
      skippedCount: 1,
      results: [{ rowNumber: 1, status: "skipped", reason: "Missing ticker" }],
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
});
