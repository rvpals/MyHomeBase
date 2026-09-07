import { describe, expect, it } from "vitest";
import type { TaxLotRepository } from "./ports";
import { createTaxLotSchema, analyzeLotsSchema } from "./schema";
import type { CreateTaxLotInput, UpdateTaxLotInput } from "./schema";
import type { TaxLot } from "./types";
import {
  analyzeLot,
  analyzePortfolio,
  analyzeTicker,
  buildCashFlows,
  classifyHoldingPeriod,
  computeCagr,
  computeYieldOnCost,
  createTaxLot,
  deleteTaxLot,
  listTaxLots,
  listTaxLotTickers,
  normalizeStoredLot,
  updateTaxLot,
  yearsBetween,
  type LotAnalysisContext,
} from "./tax-lots";

/** A hand-written in-memory port, per ARCHITECTURE.md — fakes over mocks. */
class FakeTaxLotRepository implements TaxLotRepository {
  private nextId = 1;
  readonly lots: TaxLot[] = [];

  constructor(seed: Partial<TaxLot>[] = []) {
    for (const lot of seed) this.seedLot(lot);
  }

  private seedLot(lot: Partial<TaxLot>): TaxLot {
    const created: TaxLot = {
      id: this.nextId++,
      ticker: "NVDA",
      buyDate: "2020-01-01",
      shares: 10,
      pricePerShareCents: 10_000,
      isSplitAdjusted: false,
      brokerageFirm: "",
      note: "",
      createdAt: "2026-01-01 00:00:00",
      updatedAt: "2026-01-01 00:00:00",
      ...lot,
    };
    this.lots.push(created);
    return created;
  }

  listLots(ticker?: string): TaxLot[] {
    return this.lots
      .filter((lot) => !ticker || lot.ticker === ticker)
      .sort((left, right) => left.buyDate.localeCompare(right.buyDate) || left.id - right.id);
  }

  getLotById(id: number): TaxLot | undefined {
    return this.lots.find((lot) => lot.id === id);
  }

  listTickers(): string[] {
    return [...new Set(this.lots.map((lot) => lot.ticker))].sort();
  }

  createLot(input: CreateTaxLotInput): TaxLot {
    return this.seedLot(input);
  }

  updateLot(id: number, input: UpdateTaxLotInput): TaxLot {
    const index = this.lots.findIndex((lot) => lot.id === id);
    if (index < 0) throw new Error(`No tax lot with id ${id}.`);
    this.lots[index] = { ...this.lots[index], ...input, updatedAt: "2026-09-06 00:00:00" };
    return this.lots[index];
  }

  deleteLot(id: number): void {
    const index = this.lots.findIndex((lot) => lot.id === id);
    if (index >= 0) this.lots.splice(index, 1);
  }
}

const TODAY = "2026-09-06";

/** NVDA at $170 with $2.50 trailing EPS, measured on a fixed date. */
const CONTEXT: LotAnalysisContext = {
  ticker: "NVDA",
  currentMarketPrice: 170,
  trailingEPS: 2.5,
  today: TODAY,
};

function lot(overrides: Partial<TaxLot>): TaxLot {
  return {
    id: 1,
    ticker: "NVDA",
    buyDate: "2020-01-01",
    shares: 10,
    pricePerShareCents: 10_000,
    isSplitAdjusted: false,
    brokerageFirm: "",
    note: "",
    createdAt: "2026-01-01 00:00:00",
    updatedAt: "2026-01-01 00:00:00",
    ...overrides,
  };
}

describe("yearsBetween", () => {
  it("measures a whole year against the 365.25-day convention", () => {
    expect(yearsBetween("2025-01-01", "2026-01-01")).toBeCloseTo(365 / 365.25, 6);
  });

  it("is 0 for the same day", () => {
    expect(yearsBetween(TODAY, TODAY)).toBe(0);
  });

  it("clamps a future buy date to 0 rather than reporting negative time", () => {
    expect(yearsBetween("2027-01-01", TODAY)).toBe(0);
  });

  it("is 0 for an unparseable date rather than NaN", () => {
    expect(yearsBetween("not-a-date", TODAY)).toBe(0);
  });
});

describe("classifyHoldingPeriod", () => {
  it("is long-term at exactly one year — the threshold is inclusive", () => {
    expect(classifyHoldingPeriod(1.0)).toBe("LONG_TERM");
  });

  it("is short-term a hair under a year", () => {
    expect(classifyHoldingPeriod(0.9999)).toBe("SHORT_TERM");
  });

  it("is short-term at zero", () => {
    expect(classifyHoldingPeriod(0)).toBe("SHORT_TERM");
  });
});

describe("computeCagr", () => {
  it("annualizes a doubling over two years to ~41.4%", () => {
    expect(computeCagr(100, 200, 2)).toBeCloseTo(2 ** 0.5 - 1, 10);
  });

  it("is 0 when nothing has elapsed — annualizing zero time is undefined", () => {
    expect(computeCagr(100, 200, 0)).toBe(0);
  });

  it("is 0 when the cost per share is 0", () => {
    expect(computeCagr(0, 200, 3)).toBe(0);
  });

  it("is negative for a position that fell", () => {
    expect(computeCagr(200, 100, 2)).toBeCloseTo(0.5 ** 0.5 - 1, 10);
  });
});

describe("computeYieldOnCost", () => {
  it("expresses EPS as a percent of cost per share", () => {
    expect(computeYieldOnCost(4.5, 90)).toBeCloseTo(5, 10);
  });

  it("is 0 when EPS is unknown", () => {
    expect(computeYieldOnCost(0, 90)).toBe(0);
  });

  it("is 0 when the cost per share is 0", () => {
    expect(computeYieldOnCost(4.5, 0)).toBe(0);
  });
});

describe("normalizeStoredLot", () => {
  it("applies the split table to an unadjusted historical lot", () => {
    // 10 shares at $180 in 2019 → 400 at $4.50.
    const result = normalizeStoredLot(
      lot({ buyDate: "2019-03-15", shares: 10, pricePerShareCents: 18_000 }),
    );

    expect(result.cumulativeSplitFactor).toBe(40);
    expect(result.adjustedShares).toBe(400);
    expect(result.adjustedCostPerShare).toBeCloseTo(4.5, 10);
  });

  it("leaves an already-adjusted lot alone", () => {
    const result = normalizeStoredLot(
      lot({
        buyDate: "2019-03-15",
        shares: 400,
        pricePerShareCents: 450,
        isSplitAdjusted: true,
      }),
    );

    expect(result.cumulativeSplitFactor).toBe(1);
    expect(result.adjustedShares).toBe(400);
    expect(result.adjustedCostPerShare).toBeCloseTo(4.5, 10);
  });
});

describe("analyzeLot", () => {
  it("scores a long-held pre-split lot", () => {
    const result = analyzeLot(
      lot({ buyDate: "2019-03-15", shares: 10, pricePerShareCents: 18_000 }),
      CONTEXT,
    );

    expect(result.adjustedShares).toBe(400);
    expect(result.costBasis).toBeCloseTo(1800, 8);
    expect(result.currentValue).toBeCloseTo(68_000, 8);
    expect(result.unrealizedGainDollars).toBeCloseTo(66_200, 8);
    expect(result.unrealizedGainPercent).toBeCloseTo(3677.78, 2);
    expect(result.taxClassification).toBe("LONG_TERM");
    expect(result.isTrimCandidate).toBe(true);
    expect(result.yieldOnCost).toBeCloseTo(55.56, 2);
    expect(result.cagr).toBeGreaterThan(0.5);
  });

  it("marks a lot held under a year short-term and not a trim candidate", () => {
    // Bought six months before `today`, and in profit — profitable but taxed at
    // the short-term rate, so deliberately NOT flagged for trimming.
    const result = analyzeLot(
      lot({ buyDate: "2026-03-06", shares: 10, pricePerShareCents: 10_000, isSplitAdjusted: true }),
      CONTEXT,
    );

    expect(result.yearsHeld).toBeLessThan(1);
    expect(result.taxClassification).toBe("SHORT_TERM");
    expect(result.unrealizedGainDollars).toBeGreaterThan(0);
    expect(result.isTrimCandidate).toBe(false);
  });

  it("reports a zero return as exactly zero", () => {
    // Bought at today's price: no gain, no loss, and a CAGR of 0.
    const result = analyzeLot(
      lot({ buyDate: "2023-01-01", shares: 10, pricePerShareCents: 17_000, isSplitAdjusted: true }),
      CONTEXT,
    );

    expect(result.unrealizedGainDollars).toBeCloseTo(0, 10);
    expect(result.unrealizedGainPercent).toBeCloseTo(0, 10);
    expect(result.cagr).toBeCloseTo(0, 10);
    expect(result.taxClassification).toBe("LONG_TERM");
    // At a flat return there is no gain to realize, so there is nothing to trim.
    expect(result.isTrimCandidate).toBe(false);
  });

  it("reports a negative gain for a losing lot", () => {
    const result = analyzeLot(
      lot({ buyDate: "2024-01-02", shares: 10, pricePerShareCents: 40_000, isSplitAdjusted: true }),
      CONTEXT,
    );

    expect(result.costBasis).toBeCloseTo(4000, 8);
    expect(result.currentValue).toBeCloseTo(1700, 8);
    expect(result.unrealizedGainDollars).toBeCloseTo(-2300, 8);
    expect(result.unrealizedGainPercent).toBeCloseTo(-57.5, 6);
    expect(result.cagr).toBeLessThan(0);
    // Long-term, but at a loss — a harvesting candidate, not a trimming one.
    expect(result.taxClassification).toBe("LONG_TERM");
    expect(result.isTrimCandidate).toBe(false);
  });

  it("is 0-safe for a lot recorded at no cost", () => {
    // A gift or a vested grant entered at zero. Nothing should be NaN or Infinity.
    const result = analyzeLot(
      lot({ buyDate: "2020-01-01", shares: 10, pricePerShareCents: 0, isSplitAdjusted: true }),
      CONTEXT,
    );

    expect(result.costBasis).toBe(0);
    expect(result.unrealizedGainPercent).toBe(0);
    expect(result.cagr).toBe(0);
    expect(result.yieldOnCost).toBe(0);
    expect(Number.isFinite(result.currentValue)).toBe(true);
  });

  it("carries the stored id through so a row can be edited", () => {
    expect(analyzeLot(lot({ id: 42 }), CONTEXT).id).toBe(42);
  });
});

describe("buildCashFlows", () => {
  it("makes each purchase an outflow and the valuation the terminal inflow", () => {
    const analysis = analyzePortfolio(
      [
        lot({ id: 1, buyDate: "2019-03-15", shares: 10, pricePerShareCents: 18_000 }),
        lot({ id: 2, buyDate: "2022-01-10", shares: 20, pricePerShareCents: 20_000 }),
      ],
      CONTEXT,
    );

    const flows = buildCashFlows(analysis.lots, analysis.summary.totalCurrentValue, TODAY);

    expect(flows).toHaveLength(3);
    expect(flows[0].amount).toBeLessThan(0);
    expect(flows[1].amount).toBeLessThan(0);
    expect(flows[2]).toEqual({
      date: TODAY,
      amount: analysis.summary.totalCurrentValue,
    });
  });
});

describe("analyzePortfolio", () => {
  // One lot from each split era, which is what makes the blended basis worth
  // computing at all: the raw prices ($180, $200, $140) are not comparable.
  const lots = [
    lot({ id: 3, buyDate: "2025-01-02", shares: 50, pricePerShareCents: 14_000 }),
    lot({ id: 1, buyDate: "2019-03-15", shares: 10, pricePerShareCents: 18_000 }),
    lot({ id: 2, buyDate: "2022-01-10", shares: 20, pricePerShareCents: 20_000 }),
  ];

  it("returns lots oldest first regardless of input order", () => {
    const { lots: scored } = analyzePortfolio(lots, CONTEXT);
    expect(scored.map((entry) => entry.buyDate)).toEqual([
      "2019-03-15",
      "2022-01-10",
      "2025-01-02",
    ]);
  });

  it("totals capital, value and gain across the lots", () => {
    const { summary } = analyzePortfolio(lots, CONTEXT);

    // 400 + 200 + 50 adjusted shares; $1,800 + $4,000 + $7,000 invested.
    expect(summary.lotCount).toBe(3);
    expect(summary.totalAdjustedShares).toBeCloseTo(650, 8);
    expect(summary.totalCapitalInvested).toBeCloseTo(12_800, 8);
    expect(summary.totalCurrentValue).toBeCloseTo(110_500, 8);
    expect(summary.totalGainDollars).toBeCloseTo(97_700, 8);
    expect(summary.totalGainPercent).toBeCloseTo(763.28, 2);
  });

  it("blends the cost basis across split eras", () => {
    const { summary } = analyzePortfolio(lots, CONTEXT);

    // $12,800 / 650 adjusted shares.
    expect(summary.blendedCostBasis).toBeCloseTo(19.6923, 4);
    expect(summary.blendedYieldOnCost).toBeCloseTo(12.6953, 4);
  });

  it("solves an XIRR over the unevenly spaced buys", () => {
    const { summary } = analyzePortfolio(lots, CONTEXT);

    expect(summary.xirr).toBeDefined();
    expect(summary.xirr!).toBeGreaterThan(0);
  });

  it("splits value between long- and short-term", () => {
    const withRecent = [
      ...lots,
      lot({
        id: 4,
        buyDate: "2026-06-01",
        shares: 10,
        pricePerShareCents: 15_000,
        isSplitAdjusted: true,
      }),
    ];
    const { summary } = analyzePortfolio(withRecent, CONTEXT);

    expect(summary.longTermLotCount).toBe(3);
    expect(summary.shortTermLotCount).toBe(1);
    expect(summary.shortTermValue).toBeCloseTo(1700, 8);
    expect(summary.longTermValue).toBeCloseTo(110_500, 8);
  });

  it("reports an empty portfolio as zeros with no XIRR", () => {
    const { lots: scored, summary } = analyzePortfolio([], CONTEXT);

    expect(scored).toEqual([]);
    expect(summary.totalCapitalInvested).toBe(0);
    expect(summary.totalGainPercent).toBe(0);
    expect(summary.blendedCostBasis).toBe(0);
    expect(summary.blendedYieldOnCost).toBe(0);
    // undefined, not 0 — the UI renders "—" rather than claiming a flat return.
    expect(summary.xirr).toBeUndefined();
  });

  it("reports a portfolio bought entirely today without an XIRR", () => {
    // Every flow on one date: no elapsed time, so no rate exists.
    const { summary } = analyzePortfolio(
      [lot({ buyDate: TODAY, shares: 10, pricePerShareCents: 10_000, isSplitAdjusted: true })],
      CONTEXT,
    );

    expect(summary.totalGainDollars).toBeCloseTo(700, 8);
    expect(summary.xirr).toBeUndefined();
  });
});

describe("tax lot use-cases", () => {
  it("lists every lot, and filters by ticker case-insensitively", () => {
    const repo = new FakeTaxLotRepository([
      { ticker: "NVDA", buyDate: "2019-03-15" },
      { ticker: "AAPL", buyDate: "2013-05-01" },
    ]);

    expect(listTaxLots(repo)).toHaveLength(2);
    expect(listTaxLots(repo, "nvda")).toHaveLength(1);
    expect(listTaxLotTickers(repo)).toEqual(["AAPL", "NVDA"]);
  });

  it("creates a lot from validated input", () => {
    const repo = new FakeTaxLotRepository();
    const created = createTaxLot(
      repo,
      createTaxLotSchema.parse({
        ticker: "nvda",
        buyDate: "2019-03-15",
        shares: 10,
        pricePerShareCents: 18_000,
      }),
    );

    expect(created.ticker).toBe("NVDA");
    expect(created.isSplitAdjusted).toBe(false);
    expect(repo.listLots()).toHaveLength(1);
  });

  it("updates a lot", () => {
    const repo = new FakeTaxLotRepository([{ ticker: "NVDA" }]);
    const updated = updateTaxLot(
      repo,
      1,
      createTaxLotSchema.parse({
        ticker: "NVDA",
        buyDate: "2021-07-19",
        shares: 25,
        pricePerShareCents: 75_000,
        isSplitAdjusted: true,
      }),
    );

    expect(updated.shares).toBe(25);
    expect(updated.isSplitAdjusted).toBe(true);
  });

  it("throws rather than silently no-opping on an unknown id", () => {
    const repo = new FakeTaxLotRepository();
    const input = createTaxLotSchema.parse({
      ticker: "NVDA",
      buyDate: "2020-01-01",
      shares: 1,
      pricePerShareCents: 100,
    });

    expect(() => updateTaxLot(repo, 999, input)).toThrow(/No tax lot with id 999/);
    expect(() => deleteTaxLot(repo, 999)).toThrow(/No tax lot with id 999/);
  });

  it("deletes a lot", () => {
    const repo = new FakeTaxLotRepository([{ ticker: "NVDA" }]);
    deleteTaxLot(repo, 1);
    expect(repo.listLots()).toEqual([]);
  });

  it("analyzes only the requested ticker", () => {
    const repo = new FakeTaxLotRepository([
      { ticker: "NVDA", buyDate: "2019-03-15", shares: 10, pricePerShareCents: 18_000 },
      { ticker: "AAPL", buyDate: "2013-05-01", shares: 100, pricePerShareCents: 6_000 },
    ]);

    const { lots: scored, summary } = analyzeTicker(repo, CONTEXT);

    expect(scored).toHaveLength(1);
    expect(summary.ticker).toBe("NVDA");
    expect(summary.totalAdjustedShares).toBe(400);
  });
});

describe("schemas guard the boundary", () => {
  it("uppercases and trims a ticker", () => {
    const parsed = createTaxLotSchema.parse({
      ticker: "  nvda ",
      buyDate: "2019-03-15",
      shares: 10,
      pricePerShareCents: 18_000,
    });
    expect(parsed.ticker).toBe("NVDA");
  });

  it("rejects a malformed date", () => {
    expect(() =>
      createTaxLotSchema.parse({
        ticker: "NVDA",
        buyDate: "03/15/2019",
        shares: 10,
        pricePerShareCents: 18_000,
      }),
    ).toThrow();
  });

  it("rejects zero or negative shares", () => {
    for (const shares of [0, -5]) {
      expect(() =>
        createTaxLotSchema.parse({
          ticker: "NVDA",
          buyDate: "2019-03-15",
          shares,
          pricePerShareCents: 18_000,
        }),
      ).toThrow();
    }
  });

  it("rejects a fractional cent price", () => {
    expect(() =>
      createTaxLotSchema.parse({
        ticker: "NVDA",
        buyDate: "2019-03-15",
        shares: 10,
        pricePerShareCents: 18_000.5,
      }),
    ).toThrow();
  });

  it("accepts an analyzer request and defaults an unknown EPS to 0", () => {
    const parsed = analyzeLotsSchema.parse({
      ticker: "nvda",
      currentMarketPrice: 170,
      today: TODAY,
    });
    expect(parsed.trailingEPS).toBe(0);
    expect(parsed.ticker).toBe("NVDA");
  });
});
