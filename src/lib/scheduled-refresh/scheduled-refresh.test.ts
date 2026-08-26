import { describe, expect, it } from "vitest";
import type { MarketDataClient, Quote } from "@/lib/market-data";
import type { DailySnapshotRepository } from "@/lib/stock-daily-snapshot";
import type { StockPosition, StockPositionRepository } from "@/lib/stock-positions";
import type { TickerProfileClient, TickerProfileRepository } from "@/lib/ticker-profiles";
import { runScheduledRefresh, type ScheduledRefreshDeps } from "./scheduled-refresh";

const TODAY = "2026-08-20";

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
    costCents: 100000,
    unitCostCents: 10000,
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

function quote(ticker: string, priceCents: number): Quote {
  return {
    ticker,
    priceCents,
    previousCloseCents: priceCents,
    shortName: ticker,
    dayHighCents: priceCents,
    dayLowCents: priceCents,
    dividendRateCents: 0,
  };
}

// Hand-written fakes — no mocking framework, same style as the other lib tests.
// Fully typed rather than cast through `unknown`: the annotation is what makes a
// change to the port show up here as a compile error instead of a silent gap.
function fakePositionRepo(seed: StockPosition[]): StockPositionRepository {
  let positions = [...seed];
  const same = (p: StockPosition, accountId: number, ticker: string) =>
    p.accountId === accountId && p.ticker === ticker;

  const repo: StockPositionRepository = {
    listPositions: () => [...positions],
    getPosition: ({ accountId, ticker }) => positions.find((p) => same(p, accountId, ticker)),
    listPositionsByTicker: (ticker) => positions.filter((p) => p.ticker === ticker),
    upsertPosition(input, valueCents) {
      const saved: StockPosition = {
        ...input,
        valueCents,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      };
      positions = positions.map((p) => (same(p, input.accountId, input.ticker) ? saved : p));
      return saved;
    },
    deletePosition: () => undefined,
    // The transaction half of the port is untouched by a refresh pass; these
    // throw rather than returning empties so a future caller can't quietly rely
    // on a fake that pretends the ledger is empty.
    listTransactions: () => [],
    getTransactionById: () => undefined,
    createTransaction: () => {
      throw new Error("createTransaction is not part of a refresh pass.");
    },
    updateTransaction: () => {
      throw new Error("updateTransaction is not part of a refresh pass.");
    },
    deleteTransaction: () => undefined,
    hasTransactionWithExternalId: () => false,
    countMatchingTransactions: () => 0,
  };
  return repo;
}

function fakeMarketDataClient(quotes: Record<string, Quote | Error>): MarketDataClient {
  return {
    async getQuote(ticker) {
      const result = quotes[ticker];
      if (result === undefined) throw new Error(`No quote for ${ticker}.`);
      if (result instanceof Error) throw result;
      return result;
    },
    async getHistory() {
      return [];
    },
  };
}

function fakeProfileRepo(): TickerProfileRepository & { saved: string[] } {
  const saved: string[] = [];
  return {
    saved,
    get: () => undefined,
    list: () => [],
    save(ticker) {
      saved.push(ticker);
    },
  };
}

function fakeProfileClient(behavior: "ok" | "throw" = "ok"): TickerProfileClient {
  return {
    source: "fake",
    async fetch() {
      if (behavior === "throw") throw new Error("provider down");
      return { sector: "Technology", industry: "Consumer Electronics", longName: "" };
    },
  } as unknown as TickerProfileClient;
}

function fakeSnapshotRepo(behavior: "ok" | "throw" = "ok"): DailySnapshotRepository & {
  savedDates: string[];
} {
  const savedDates: string[] = [];
  return {
    savedDates,
    listSnapshots: () => [],
    getSnapshot: () => undefined,
    upsertSnapshot(input, totals) {
      if (behavior === "throw") throw new Error("disk full");
      savedDates.push(input.snapshotDate);
      return { ...input, ...totals } as never;
    },
    deleteSnapshot: () => undefined,
  };
}

function buildDeps(overrides: Partial<ScheduledRefreshDeps> = {}): ScheduledRefreshDeps {
  return {
    positionRepo: fakePositionRepo([makePosition()]),
    marketDataClient: fakeMarketDataClient({ AAPL: quote("AAPL", 16000) }),
    profileRepo: fakeProfileRepo(),
    profileClient: fakeProfileClient(),
    snapshotRepo: fakeSnapshotRepo(),
    today: TODAY,
    ...overrides,
  };
}

describe("runScheduledRefresh", () => {
  it("prices every position, looks up sectors, and files the day's snapshot", async () => {
    const snapshotRepo = fakeSnapshotRepo();
    const profileRepo = fakeProfileRepo();

    const summary = await runScheduledRefresh(
      buildDeps({
        positionRepo: fakePositionRepo([
          makePosition({ ticker: "AAPL" }),
          makePosition({ ticker: "MSFT" }),
        ]),
        marketDataClient: fakeMarketDataClient({
          AAPL: quote("AAPL", 16000),
          MSFT: quote("MSFT", 42000),
        }),
        profileRepo,
        snapshotRepo,
      }),
    );

    expect(summary.ran).toBe(true);
    expect(summary.status).toBe("ok");
    expect(summary.pricedCount).toBe(2);
    expect(summary.failedCount).toBe(0);
    expect(summary.snapshotSaved).toBe(true);
    // Filed under the injected date, not the wall clock.
    expect(snapshotRepo.savedDates).toEqual([TODAY]);
    expect(profileRepo.saved).toEqual(["AAPL", "MSFT"]);
  });

  it("skips without running when there are no positions", async () => {
    const snapshotRepo = fakeSnapshotRepo();

    const summary = await runScheduledRefresh(
      buildDeps({ positionRepo: fakePositionRepo([]), snapshotRepo }),
    );

    expect(summary.ran).toBe(false);
    expect(summary.reason).toBe("No positions to refresh.");
    // No empty snapshot filed for a portfolio that does not exist yet.
    expect(snapshotRepo.savedDates).toEqual([]);
  });

  it("reports partial and still snapshots when one ticker cannot be priced", async () => {
    const snapshotRepo = fakeSnapshotRepo();

    const summary = await runScheduledRefresh(
      buildDeps({
        positionRepo: fakePositionRepo([
          makePosition({ ticker: "AAPL" }),
          makePosition({ ticker: "DEAD" }),
        ]),
        marketDataClient: fakeMarketDataClient({
          AAPL: quote("AAPL", 16000),
          DEAD: new Error("delisted"),
        }),
        snapshotRepo,
      }),
    );

    expect(summary.status).toBe("partial");
    expect(summary.pricedCount).toBe(1);
    expect(summary.failedCount).toBe(1);
    // One bad symbol must not cost the day its history entry.
    expect(summary.snapshotSaved).toBe(true);
    expect(summary.detail).toContain("1 failed");
  });

  it("does not fail the pass when the sector provider is down", async () => {
    const summary = await runScheduledRefresh(
      buildDeps({ profileClient: fakeProfileClient("throw") }),
    );

    // A missing chart label is not a reason to report a price update as broken.
    expect(summary.status).toBe("ok");
    expect(summary.pricedCount).toBe(1);
    expect(summary.sectorsFetchedCount).toBe(0);
    expect(summary.snapshotSaved).toBe(true);
  });

  it("reports partial when prices landed but the snapshot could not be saved", async () => {
    const summary = await runScheduledRefresh(
      buildDeps({ snapshotRepo: fakeSnapshotRepo("throw") }),
    );

    expect(summary.status).toBe("partial");
    expect(summary.pricedCount).toBe(1);
    expect(summary.snapshotSaved).toBe(false);
    expect(summary.detail).toContain("disk full");
  });

  it("reports failed without throwing when nothing could be priced at all", async () => {
    const summary = await runScheduledRefresh(
      buildDeps({
        marketDataClient: fakeMarketDataClient({ AAPL: new Error("network unreachable") }),
      }),
    );

    // Never throws: inside a timer an exception becomes an unhandled rejection.
    expect(summary.ran).toBe(true);
    expect(summary.status).toBe("failed");
    expect(summary.pricedCount).toBe(0);
  });
});

// The empty-portfolio check lives in BOTH `runScheduledRefresh` (so a direct
// caller gets a sensible summary) and `runScheduledRefreshNow` (so the skip
// happens before the run is stamped and cannot burn the interval). This asserts
// the inner half; the outer half is the `deps`-bound runner, exercised through
// the CLI.
describe("runScheduledRefresh: the empty-portfolio guard", () => {
  it("touches nothing at all when there are no positions", async () => {
    const snapshotRepo = fakeSnapshotRepo();
    const profileRepo = fakeProfileRepo();
    let quotesRequested = 0;
    const countingClient: MarketDataClient = {
      async getQuote(ticker) {
        quotesRequested += 1;
        return quote(ticker, 100);
      },
      async getHistory() {
        return [];
      },
    };

    const summary = await runScheduledRefresh(
      buildDeps({
        positionRepo: fakePositionRepo([]),
        marketDataClient: countingClient,
        profileRepo,
        snapshotRepo,
      }),
    );

    expect(summary.ran).toBe(false);
    // No outbound calls to a rate-limited provider for a portfolio with nothing in it.
    expect(quotesRequested).toBe(0);
    expect(profileRepo.saved).toEqual([]);
    expect(snapshotRepo.savedDates).toEqual([]);
  });
});
