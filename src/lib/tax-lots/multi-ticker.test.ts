// Tests for the multi-ticker roll-up.
//
// The claims worth holding down here are about what does and does not add up across
// symbols: the dollar figures and the XIRR do, share counts and a blended per-share
// basis do not, and each ticker's own section must match what the single-ticker
// screen would have shown for the same lots.

import { describe, expect, it } from "vitest";
import { analyzeMultipleTickers, summarizeAcrossTickers } from "./multi-ticker";
import type { TickerPricing } from "./multi-ticker";
import { adhocLotSchema, multiTickerLotsSchema, type AdhocLotInput } from "./schema";
import { analyzeAdhocLots } from "./tax-lots";

function adhocLot(overrides: Partial<AdhocLotInput> = {}): AdhocLotInput {
  return adhocLotSchema.parse({
    buyDate: "2020-01-01",
    shares: 10,
    pricePerShare: 100,
    isSplitAdjusted: true,
    ...overrides,
  });
}

const TODAY = "2026-09-08";

/** Priced so every ticker has a live price, unless a test says otherwise. */
function pricing(entries: Record<string, number>): Map<string, TickerPricing> {
  return new Map(
    Object.entries(entries).map(([ticker, currentMarketPrice]) => [
      ticker,
      { ticker, currentMarketPrice, hasLivePrice: true, trailingEPS: 0 },
    ]),
  );
}

describe("analyzeMultipleTickers", () => {
  const input = multiTickerLotsSchema.parse({
    today: TODAY,
    tickers: [
      { ticker: "AAA", lots: [adhocLot({ shares: 10, pricePerShare: 100 })] },
      {
        ticker: "BBB",
        lots: [
          adhocLot({ buyDate: "2021-01-01", shares: 5, pricePerShare: 200 }),
          adhocLot({ buyDate: "2022-01-01", shares: 5, pricePerShare: 400 }),
        ],
      },
    ],
  });

  it("returns one section per ticker, in the order passed", () => {
    const result = analyzeMultipleTickers(input, pricing({ AAA: 150, BBB: 500 }));
    expect(result.sections.map((section) => section.ticker)).toEqual(["AAA", "BBB"]);
    expect(result.sections[0].analysis.lots).toHaveLength(1);
    expect(result.sections[1].analysis.lots).toHaveLength(2);
  });

  it("scores each ticker at its own price", () => {
    const result = analyzeMultipleTickers(input, pricing({ AAA: 150, BBB: 500 }));
    // AAA: 10 shares at 150.
    expect(result.sections[0].analysis.summary.totalCurrentValue).toBeCloseTo(1_500, 6);
    // BBB: 10 shares at 500.
    expect(result.sections[1].analysis.summary.totalCurrentValue).toBeCloseTo(5_000, 6);
  });

  it("matches what the single-ticker analyzer reports for the same lots", () => {
    // The whole point of building this on `analyzeAdhocLots` rather than beside it.
    const result = analyzeMultipleTickers(input, pricing({ AAA: 150, BBB: 500 }));
    const alone = analyzeAdhocLots({
      ticker: "BBB",
      currentMarketPrice: 500,
      trailingEPS: 0,
      today: TODAY,
      lots: input.tickers[1].lots,
    });

    const section = result.sections[1].analysis.summary;
    expect(section.totalCapitalInvested).toBeCloseTo(alone.summary.totalCapitalInvested, 6);
    expect(section.totalGainPercent).toBeCloseTo(alone.summary.totalGainPercent, 6);
    expect(section.blendedCostBasis).toBeCloseTo(alone.summary.blendedCostBasis, 6);
    expect(section.xirr).toBeCloseTo(alone.summary.xirr!, 6);
  });

  it("sums the dollar figures into the grand total", () => {
    const result = analyzeMultipleTickers(input, pricing({ AAA: 150, BBB: 500 }));
    // 1_000 + (1_000 + 2_000)
    expect(result.totals.totalCapitalInvested).toBeCloseTo(4_000, 6);
    expect(result.totals.totalCurrentValue).toBeCloseTo(6_500, 6);
    expect(result.totals.totalGainDollars).toBeCloseTo(2_500, 6);
    expect(result.totals.totalGainPercent).toBeCloseTo(62.5, 6);
    expect(result.totals.tickerCount).toBe(2);
    expect(result.totals.lotCount).toBe(3);
  });

  it("solves one XIRR across every purchase rather than averaging the per-ticker rates", () => {
    const result = analyzeMultipleTickers(input, pricing({ AAA: 150, BBB: 500 }));
    const perTicker = result.sections.map((section) => section.analysis.summary.xirr!);
    const mean = perTicker.reduce((sum, rate) => sum + rate, 0) / perTicker.length;

    expect(result.totals.xirr).toBeDefined();
    // A mean of rates weights a small position like a large one, so the combined
    // rate must NOT coincidentally equal it here.
    expect(result.totals.xirr).not.toBeCloseTo(mean, 6);
    // Sanity: a basket up 62.5% over several years is a positive annual rate.
    expect(result.totals.xirr!).toBeGreaterThan(0);
  });

  it("splits long and short term by value across tickers", () => {
    const recent = multiTickerLotsSchema.parse({
      today: TODAY,
      tickers: [
        { ticker: "AAA", lots: [adhocLot({ buyDate: "2020-01-01", shares: 10, pricePerShare: 100 })] },
        { ticker: "BBB", lots: [adhocLot({ buyDate: "2026-08-01", shares: 10, pricePerShare: 100 })] },
      ],
    });
    const result = analyzeMultipleTickers(recent, pricing({ AAA: 200, BBB: 200 }));

    expect(result.totals.longTermLotCount).toBe(1);
    expect(result.totals.shortTermLotCount).toBe(1);
    expect(result.totals.longTermValue).toBeCloseTo(2_000, 6);
    expect(result.totals.shortTermValue).toBeCloseTo(2_000, 6);
  });

  it("counts trim candidates across every ticker", () => {
    const result = analyzeMultipleTickers(input, pricing({ AAA: 150, BBB: 500 }));
    // All three lots are long-term and in profit at these prices.
    expect(result.totals.trimCandidateCount).toBe(3);
  });

  it("does not report a blended cost basis on the total", () => {
    // Dollars per share across different symbols is not a unit. This asserts the
    // omission is deliberate, so re-adding it has to be a conscious change.
    const result = analyzeMultipleTickers(input, pricing({ AAA: 150, BBB: 500 }));
    expect("blendedCostBasis" in result.totals).toBe(false);
  });

  it("falls back to the newest lot's price when a ticker has no live price", () => {
    const result = analyzeMultipleTickers(input, new Map());
    // BBB's newest lot was bought at 400, so that is the assumed price.
    expect(result.sections[1].currentMarketPrice).toBeCloseTo(400, 6);
    expect(result.sections[1].hasLivePrice).toBe(false);
    // AAA's only lot was 100.
    expect(result.sections[0].currentMarketPrice).toBeCloseTo(100, 6);
  });

  it("marks a ticker as live-priced only when pricing supplied one", () => {
    const mixed = new Map<string, TickerPricing>([
      ["AAA", { ticker: "AAA", currentMarketPrice: 150, hasLivePrice: true, trailingEPS: 0 }],
    ]);
    const result = analyzeMultipleTickers(input, mixed);
    expect(result.sections[0].hasLivePrice).toBe(true);
    expect(result.sections[1].hasLivePrice).toBe(false);
  });

  it("honours the split table per ticker", () => {
    // NVDA is in the split table (40x for a 2020 buy); AAA is not.
    const withSplits = multiTickerLotsSchema.parse({
      today: TODAY,
      tickers: [
        {
          ticker: "NVDA",
          lots: [adhocLot({ buyDate: "2020-01-01", shares: 10, pricePerShare: 100, isSplitAdjusted: false })],
        },
        {
          ticker: "AAA",
          lots: [adhocLot({ buyDate: "2020-01-01", shares: 10, pricePerShare: 100, isSplitAdjusted: false })],
        },
      ],
    });
    const result = analyzeMultipleTickers(withSplits, pricing({ NVDA: 175, AAA: 175 }));

    expect(result.sections[0].analysis.lots[0].adjustedShares).toBe(400);
    expect(result.sections[1].analysis.lots[0].adjustedShares).toBe(10);
    // The split moved no money: both cost $1,000.
    expect(result.totals.totalCapitalInvested).toBeCloseTo(2_000, 6);
  });
});

describe("summarizeAcrossTickers", () => {
  it("reports zeros and no XIRR for an empty selection", () => {
    const totals = summarizeAcrossTickers([], TODAY);
    expect(totals.tickerCount).toBe(0);
    expect(totals.lotCount).toBe(0);
    expect(totals.totalCapitalInvested).toBe(0);
    // undefined, never 0 — a missing rate is not a flat return.
    expect(totals.xirr).toBeUndefined();
  });

  it("reports 0% rather than dividing by zero when nothing was invested", () => {
    const sections = [
      {
        ticker: "AAA",
        currentMarketPrice: 0,
        hasLivePrice: false,
        analysis: analyzeAdhocLots({
          ticker: "AAA",
          currentMarketPrice: 0,
          trailingEPS: 0,
          today: TODAY,
          lots: [adhocLot({ shares: 10, pricePerShare: 0 })],
        }),
      },
    ];
    expect(summarizeAcrossTickers(sections, TODAY).totalGainPercent).toBe(0);
  });
});

describe("multiTickerLotsSchema", () => {
  it("uppercases every ticker", () => {
    const parsed = multiTickerLotsSchema.parse({
      today: TODAY,
      tickers: [{ ticker: "nvda", lots: [adhocLot()] }],
    });
    expect(parsed.tickers[0].ticker).toBe("NVDA");
  });

  it("rejects an empty selection", () => {
    expect(() => multiTickerLotsSchema.parse({ today: TODAY, tickers: [] })).toThrow(
      /at least one ticker/i,
    );
  });

  it("rejects a ticker carrying no lots", () => {
    expect(() =>
      multiTickerLotsSchema.parse({ today: TODAY, tickers: [{ ticker: "AAA", lots: [] }] }),
    ).toThrow();
  });

  it("refuses an unbounded ticker list", () => {
    const tickers = Array.from({ length: 31 }, (_, index) => ({
      ticker: `T${index}`,
      lots: [adhocLot()],
    }));
    expect(() => multiTickerLotsSchema.parse({ today: TODAY, tickers })).toThrow();
  });
});
