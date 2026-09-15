/**
 * How `buildPortfolioExport` feeds the correlation matrix into the payload.
 *
 * The seam worth pinning: the weights a correlation pair reports come from the
 * holdings the same call just built, and a ticker the matrix names but the
 * portfolio no longer holds is dropped rather than advised on.
 */

import { describe, expect, it } from "vitest";
import type { CorrelationResult } from "@/lib/stock-analytics";
import type { StockPosition } from "@/lib/stock-positions";
import { buildPortfolioExport, type ExportAccountInput } from "./portfolio-export";

function position(overrides: Partial<StockPosition> = {}): StockPosition {
  return {
    accountId: 1,
    ticker: "AAPL",
    name: "Apple Inc",
    type: "Stock",
    currentPriceCents: 20_000,
    quantity: 10,
    dayGainLossCents: 0,
    valueCents: 200_000,
    dayHighCents: 0,
    dayLowCents: 0,
    dividendRateCents: 0,
    costCents: 150_000,
    unitCostCents: 15_000,
    unrealizedGainLossCents: 50_000,
    unrealizedGainLossPct: 33.33,
    cusip: "",
    isin: "",
    assetClass: "",
    assetStrategy: "",
    estAnnualIncomeCents: 0,
    incomeEarnedCents: 0,
    createdAt: "2026-01-01 00:00:00",
    updatedAt: "2026-01-01 00:00:00",
    ...overrides,
  };
}

const ACCOUNTS: ExportAccountInput[] = [{ id: 1, name: "Chase Joint Stock Account" }];

/** Two equal holdings, so each is 50% of the portfolio. */
const POSITIONS = [
  position({ ticker: "AAPL", valueCents: 200_000 }),
  position({ ticker: "MSFT", name: "Microsoft", valueCents: 200_000 }),
];

function matrix(overrides: Partial<CorrelationResult> = {}): CorrelationResult {
  return {
    tickers: ["AAPL", "MSFT"],
    matrix: [
      [1, 0.75],
      [0.75, 1],
    ],
    marketCorrelation: { AAPL: 0.9, MSFT: 0.88 },
    failedTickers: [],
    calculatedAt: "2026-08-04T10:00:00.000Z",
    ...overrides,
  };
}

function build(overrides: Parameters<typeof buildPortfolioExport>[0] | null = null) {
  return buildPortfolioExport(
    overrides ?? {
      positions: POSITIONS,
      accounts: ACCOUNTS,
      sectorsByTicker: new Map([
        ["AAPL", "Technology"],
        ["MSFT", "Technology"],
      ]),
      asOf: "2026-08-05",
      focus: ["diversification"],
      correlation: matrix(),
      now: new Date("2026-08-05T10:00:00.000Z"),
    },
  );
}

describe("buildPortfolioExport with a correlation matrix", () => {
  it("attaches the summarised insight", () => {
    const payload = build();
    expect(payload.correlation?.pairCount).toBe(1);
    expect(payload.correlation?.mostCorrelated[0]).toMatchObject({
      tickerA: "AAPL",
      tickerB: "MSFT",
      correlation: 0.75,
    });
  });

  it("reports the pair's combined weight from the holdings it just built", () => {
    // Two equal holdings: 50% each, so the pair is the whole portfolio.
    expect(build().correlation?.mostCorrelated[0].combinedWeightPct).toBe(100);
  });

  it("omits the insight entirely when no matrix is supplied", () => {
    const payload = buildPortfolioExport({
      positions: POSITIONS,
      accounts: ACCOUNTS,
      sectorsByTicker: new Map(),
      asOf: "2026-08-05",
      focus: ["diversification"],
    });
    expect(payload.correlation).toBeUndefined();
  });

  it("drops a ticker the stale matrix names but the portfolio no longer holds", () => {
    const payload = buildPortfolioExport({
      positions: [position({ ticker: "AAPL" })],
      accounts: ACCOUNTS,
      sectorsByTicker: new Map([["AAPL", "Technology"]]),
      asOf: "2026-08-05",
      focus: ["diversification"],
      correlation: matrix(),
      now: new Date("2026-08-05T10:00:00.000Z"),
    });
    // Only AAPL is held, so the one pair loses its partner and there is nothing
    // left to compare — an absent section rather than a misleading one.
    expect(payload.correlation).toBeUndefined();
  });

  it("finds the sector gaps from the holdings' own sectors", () => {
    const gaps = build().correlation?.sectorGaps ?? [];
    // Everything is Technology, so every other GICS sector is absent.
    expect(gaps.some((gap) => gap.sector === "Utilities" && gap.status === "absent")).toBe(true);
    expect(gaps.some((gap) => gap.sector === "Technology")).toBe(false);
  });

  it("treats a fund's missing sector as no sector, not as a twelfth one", () => {
    const payload = buildPortfolioExport({
      positions: [
        position({ ticker: "VOO", type: "ETF", valueCents: 200_000 }),
        position({ ticker: "AAPL", valueCents: 200_000 }),
      ],
      accounts: ACCOUNTS,
      sectorsByTicker: new Map([["AAPL", "Technology"]]),
      asOf: "2026-08-05",
      focus: ["diversification"],
      correlation: matrix({
        tickers: ["VOO", "AAPL"],
        marketCorrelation: { VOO: 0.99, AAPL: 0.9 },
      }),
      now: new Date("2026-08-05T10:00:00.000Z"),
    });
    const gaps = payload.correlation?.sectorGaps ?? [];
    expect(gaps.some((gap) => gap.sector === "Unclassified")).toBe(false);
  });

  it("carries no account name into the correlation section", () => {
    const text = JSON.stringify(build().correlation);
    for (const secret of ["Chase", "Joint"]) {
      expect(text).not.toContain(secret);
    }
  });
});
