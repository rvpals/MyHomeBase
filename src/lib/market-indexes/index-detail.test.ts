import { describe, expect, it } from "vitest";
import type {
  MarketDataClient,
  PricePoint,
  QuoteSummaryClient,
  RawQuoteSummary,
} from "@/lib/market-data";
import { enrichIndexQuote, loadIndexDetail, rangePosition } from "./index-detail";
import type { IndexQuote } from "./types";

/**
 * Shaped like the real payload, including Yahoo's `{ raw, fmt }` wrapping —
 * unwrapping that is half of what `enrichIndexQuote` does, so a fixture of bare
 * numbers would test the easy path only.
 */
function summary(overrides: Partial<RawQuoteSummary> = {}): RawQuoteSummary {
  return {
    summaryDetail: {
      fiftyTwoWeekLow: { raw: 4953.56, fmt: "4,953.56" },
      fiftyTwoWeekHigh: { raw: 5670.81, fmt: "5,670.81" },
      fiftyDayAverage: { raw: 5388.12 },
      twoHundredDayAverage: { raw: 5102.44 },
      allTimeHigh: { raw: 5670.81 },
    },
    defaultKeyStatistics: {
      "52WeekChange": { raw: 0.1762 },
    },
    ...overrides,
  };
}

function history(...closes: number[]): PricePoint[] {
  return closes.map((close, index) => ({
    timestamp: 1_700_000_000 + index * 300,
    closeCents: Math.round(close * 100),
  }));
}

const BASE_QUOTE: IndexQuote = {
  symbol: "^GSPC",
  label: "S&P 500",
  group: "equity",
  unit: "points",
  logoDomain: "spglobal.com",
  valueCents: 543_210,
  previousCloseCents: 540_000,
  changeCents: 3_210,
  changePct: 0.594,
  dayHighCents: 544_000,
  dayLowCents: 539_000,
};

describe("enrichIndexQuote", () => {
  it("unwraps the 52-week range, the averages and the all-time high into cents", () => {
    const detail = enrichIndexQuote(summary(), []);
    expect(detail.fiftyTwoWeekLowCents).toBe(495_356);
    expect(detail.fiftyTwoWeekHighCents).toBe(567_081);
    expect(detail.fiftyDayAverageCents).toBe(538_812);
    expect(detail.twoHundredDayAverageCents).toBe(510_244);
    expect(detail.allTimeHighCents).toBe(567_081);
  });

  /** Yahoo reports a fraction; every percentage in this app is already scaled. */
  it("turns the one-year change from a fraction into a percentage", () => {
    expect(enrichIndexQuote(summary(), []).oneYearChangePct).toBeCloseTo(17.62, 4);
  });

  /**
   * The measured gap: `GC=F`, `SI=F` and `CL=F` return an empty
   * `defaultKeyStatistics`, so the one-year change is missing while everything
   * in `summaryDetail` around it is present.
   */
  it("reports a missing one-year change without losing the rest", () => {
    const detail = enrichIndexQuote(summary({ defaultKeyStatistics: {} }), []);
    expect(detail.oneYearChangePct).toBeUndefined();
    expect(detail.fiftyTwoWeekLowCents).toBe(495_356);
    expect(detail.allTimeHighCents).toBe(567_081);
  });

  it("returns every field undefined for a payload with no sections", () => {
    const detail = enrichIndexQuote({}, []);
    expect(detail.fiftyTwoWeekLowCents).toBeUndefined();
    expect(detail.fiftyDayAverageCents).toBeUndefined();
    expect(detail.oneYearChangePct).toBeUndefined();
    expect(detail.intradayCents).toEqual([]);
  });

  it("survives an entirely absent payload", () => {
    expect(() => enrichIndexQuote(undefined, [])).not.toThrow();
    expect(enrichIndexQuote(undefined, []).intradayCents).toEqual([]);
  });

  it("carries the intraday closes through in order", () => {
    const detail = enrichIndexQuote(summary(), history(5400, 5410.5, 5395));
    expect(detail.intradayCents).toEqual([540_000, 541_050, 539_500]);
  });

  /** A bare number instead of `{ raw }` is the other half of Yahoo's inconsistency. */
  it("accepts an unwrapped number", () => {
    const detail = enrichIndexQuote(
      { summaryDetail: { fiftyTwoWeekLow: 4000 }, defaultKeyStatistics: {} },
      [],
    );
    expect(detail.fiftyTwoWeekLowCents).toBe(400_000);
  });
});

describe("rangePosition", () => {
  it("places a level between its low and high as a percentage", () => {
    expect(rangePosition(150, 100, 200)).toBe(50);
    expect(rangePosition(100, 100, 200)).toBe(0);
    expect(rangePosition(200, 100, 200)).toBe(100);
  });

  it("returns nothing when either bound is unknown", () => {
    expect(rangePosition(150, undefined, 200)).toBeUndefined();
    expect(rangePosition(150, 100, undefined)).toBeUndefined();
  });

  /**
   * The two numbers come from different calls: a level that has just made a new
   * high arrives before the 52-week high catches up, which would otherwise put
   * the marker off the end of its own track.
   */
  it("clamps a level that has outrun its reported range", () => {
    expect(rangePosition(250, 100, 200)).toBe(100);
    expect(rangePosition(50, 100, 200)).toBe(0);
  });

  it("centres the marker when the range has no width", () => {
    expect(rangePosition(100, 100, 100)).toBe(50);
  });
});

function fakeClients(options: {
  summary?: RawQuoteSummary;
  summaryThrows?: boolean;
  history?: PricePoint[];
  historyThrows?: boolean;
}): { marketData: MarketDataClient; quoteSummary: QuoteSummaryClient } {
  return {
    marketData: {
      async getQuote() {
        throw new Error("not used by loadIndexDetail");
      },
      async getHistory() {
        if (options.historyThrows) throw new Error("HTTP 429");
        return options.history ?? [];
      },
    },
    quoteSummary: {
      async getQuoteSummary() {
        if (options.summaryThrows) throw new Error("HTTP 401 — crumb rejected");
        return options.summary ?? {};
      },
    },
  };
}

describe("loadIndexDetail", () => {
  it("attaches both legs on the happy path", async () => {
    const result = await loadIndexDetail(
      fakeClients({ summary: summary(), history: history(5400, 5410) }),
      BASE_QUOTE,
    );
    expect(result.detail?.fiftyTwoWeekHighCents).toBe(567_081);
    expect(result.detail?.intradayCents).toEqual([540_000, 541_000]);
  });

  /** The legs are independent — the sparkline is worth having on its own. */
  it("keeps the sparkline when the summary call is refused", async () => {
    const result = await loadIndexDetail(
      fakeClients({ summaryThrows: true, history: history(5400, 5410) }),
      BASE_QUOTE,
    );
    expect(result.detail?.intradayCents).toEqual([540_000, 541_000]);
    expect(result.detail?.fiftyTwoWeekHighCents).toBeUndefined();
  });

  it("keeps the reference figures when the history call fails", async () => {
    const result = await loadIndexDetail(
      fakeClients({ summary: summary(), historyThrows: true }),
      BASE_QUOTE,
    );
    expect(result.detail?.fiftyTwoWeekHighCents).toBe(567_081);
    expect(result.detail?.intradayCents).toEqual([]);
  });

  /**
   * Both legs failing leaves the row exactly as the first pass produced it —
   * an absent `detail` rather than a block of undefineds, which is the contract
   * the view reads.
   */
  it("returns the original quote untouched when both legs fail", async () => {
    const result = await loadIndexDetail(
      fakeClients({ summaryThrows: true, historyThrows: true }),
      BASE_QUOTE,
    );
    expect(result).toEqual(BASE_QUOTE);
    expect(result.detail).toBeUndefined();
  });

  it("never throws, whatever the provider does", async () => {
    await expect(
      loadIndexDetail(fakeClients({ summaryThrows: true, historyThrows: true }), BASE_QUOTE),
    ).resolves.toBeDefined();
  });
});
