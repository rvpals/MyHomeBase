import { describe, expect, it } from "vitest";
import type { MarketDataClient, PricePoint, Quote } from "@/lib/market-data";
import { runSimulationSchema } from "./schema";
import {
  normalizeSeries,
  OVERLAY_STEPS,
  runSimulation,
  simulateRange,
  trimToRecentDays,
} from "./stock-simulation";

const DAY = 86_400;

/** `count` daily closes ending at a fixed instant, walking by `stepCents` a day. */
function series(count: number, startCents: number, stepCents: number): PricePoint[] {
  const end = 1_700_000_000;
  return Array.from({ length: count }, (_, i) => ({
    timestamp: end - (count - 1 - i) * DAY,
    closeCents: startCents + i * stepCents,
  }));
}

function fakeClient(byRange: Record<string, PricePoint[] | Error>): MarketDataClient {
  return {
    async getQuote(): Promise<Quote> {
      throw new Error("not used");
    },
    async getHistory(_ticker, range) {
      const found = byRange[range];
      if (found === undefined) return [];
      if (found instanceof Error) throw found;
      return found;
    },
  };
}

describe("runSimulationSchema", () => {
  it("upper-cases the ticker, trims it, and dedupes ranges", () => {
    const parsed = runSimulationSchema.parse({
      ticker: "  aapl ",
      shares: 10,
      ranges: ["1mo", "1mo", "1y"],
    });
    expect(parsed.ticker).toBe("AAPL");
    expect(parsed.ranges).toEqual(["1mo", "1y"]);
  });

  it("accepts fractional shares", () => {
    expect(runSimulationSchema.parse({ ticker: "X", shares: 0.5, ranges: ["1y"] }).shares).toBe(
      0.5,
    );
  });

  it("rejects zero, negative and non-finite share counts", () => {
    for (const shares of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => runSimulationSchema.parse({ ticker: "X", shares, ranges: ["1y"] })).toThrow();
    }
  });

  it("rejects an empty ticker, an empty range list and an unknown range", () => {
    expect(() => runSimulationSchema.parse({ ticker: "", shares: 1, ranges: ["1y"] })).toThrow();
    expect(() => runSimulationSchema.parse({ ticker: "X", shares: 1, ranges: [] })).toThrow();
    expect(() => runSimulationSchema.parse({ ticker: "X", shares: 1, ranges: ["7y"] })).toThrow();
  });
});

describe("trimToRecentDays", () => {
  it("keeps only the closes inside the window, measured from the last bar", () => {
    // 30 daily bars; 7 days back from the final bar, inclusive, is 8 bars.
    expect(trimToRecentDays(series(30, 100, 1), 7)).toHaveLength(8);
  });

  it("measures back from the final bar, not from now, so a weekend cannot shorten it", () => {
    const stale = series(30, 100, 1).map((point) => ({
      ...point,
      timestamp: point.timestamp - 10 * DAY,
    }));
    expect(trimToRecentDays(stale, 7)).toHaveLength(8);
  });

  it("returns the whole series rather than a single point when the window catches too little", () => {
    const sparse: PricePoint[] = [
      { timestamp: 0, closeCents: 100 },
      { timestamp: 400 * DAY, closeCents: 200 },
    ];
    expect(trimToRecentDays(sparse, 7)).toHaveLength(2);
  });

  it("handles an empty series", () => {
    expect(trimToRecentDays([], 7)).toEqual([]);
  });
});

describe("normalizeSeries", () => {
  it("starts at (0, 0) and ends at (100, total return)", () => {
    const points = normalizeSeries(series(5, 100, 25)); // 100 -> 200
    expect(points[0]).toMatchObject({ progressPct: 0, changePct: 0 });
    expect(points[points.length - 1].progressPct).toBe(100);
    expect(points[points.length - 1].changePct).toBeCloseTo(100);
  });

  it("reports a decline as a negative change", () => {
    const points = normalizeSeries(series(3, 200, -50)); // 200 -> 100
    expect(points[points.length - 1].changePct).toBeCloseTo(-50);
  });

  it("resamples every series onto the same fixed grid, so lines share an x-axis", () => {
    // Wildly different input lengths, identical output length and x positions.
    const short = normalizeSeries(series(5, 100, 1));
    const long = normalizeSeries(series(2_500, 100, 1));
    expect(short).toHaveLength(OVERLAY_STEPS);
    expect(long).toHaveLength(OVERLAY_STEPS);
    expect(short.map((point) => point.progressPct)).toEqual(
      long.map((point) => point.progressPct),
    );
  });

  it("carries a real close and its timestamp, never an interpolated one", () => {
    const raw = series(120, 100, 10);
    const closes = new Set(raw.map((point) => point.closeCents));
    for (const point of normalizeSeries(raw)) {
      expect(closes.has(point.closeCents)).toBe(true);
    }
  });

  it("lands its endpoints exactly on the buy close and the latest close", () => {
    const raw = series(37, 100, 7);
    const points = normalizeSeries(raw);
    expect(points[0].closeCents).toBe(raw[0].closeCents);
    expect(points[points.length - 1].closeCents).toBe(raw[raw.length - 1].closeCents);
  });

  it("puts a single point at the start instead of dividing by zero", () => {
    expect(normalizeSeries([{ timestamp: 0, closeCents: 100 }])).toEqual([
      { progressPct: 0, changePct: 0, closeCents: 100, timestamp: 0 },
    ]);
  });

  it("reports zero change rather than Infinity when the buy price is zero", () => {
    const points = normalizeSeries([
      { timestamp: 0, closeCents: 0 },
      { timestamp: DAY, closeCents: 500 },
    ]);
    expect(points.every((point) => point.changePct === 0)).toBe(true);
  });

  it("returns nothing for an empty series", () => {
    expect(normalizeSeries([])).toEqual([]);
  });
});

describe("simulateRange", () => {
  it("buys at the first close and values at the last", () => {
    const result = simulateRange("1y", series(4, 10_000, 1_000), 10); // $100 -> $130
    expect(result.buyPriceCents).toBe(10_000);
    expect(result.currentPriceCents).toBe(13_000);
    expect(result.totalCostCents).toBe(100_000);
    expect(result.currentValueCents).toBe(130_000);
    expect(result.gainLossCents).toBe(30_000);
    expect(result.gainLossPct).toBeCloseTo(30);
    expect(result.observationCount).toBe(4);
  });

  it("reports a loss as a negative gain", () => {
    const result = simulateRange("6mo", series(3, 20_000, -5_000), 2); // $200 -> $100
    expect(result.gainLossCents).toBe(-20_000);
    expect(result.gainLossPct).toBeCloseTo(-50);
  });

  it("rounds fractional shares to whole cents once, at the totals", () => {
    const result = simulateRange(
      "1mo",
      [
        { timestamp: 0, closeCents: 333 },
        { timestamp: DAY, closeCents: 999 },
      ],
      0.5,
    );
    expect(result.totalCostCents).toBe(167); // 166.5 rounded
    expect(result.currentValueCents).toBe(500); // 499.5 rounded
    expect(Number.isInteger(result.gainLossCents)).toBe(true);
  });
});

describe("runSimulation", () => {
  it("returns one simulation per requested range, in the offered order", async () => {
    const client = fakeClient({
      "1mo": series(30, 10_000, 100),
      "1y": series(200, 8_000, 20),
      "5y": series(260, 5_000, 30),
    });

    const result = await runSimulation(client, {
      ticker: "aapl",
      shares: 10,
      // Deliberately out of order — the result must come back in offered order.
      ranges: ["5y", "1mo", "1y"],
    });

    expect(result.ticker).toBe("AAPL");
    expect(result.simulations.map((s) => s.range)).toEqual(["1mo", "1y", "5y"]);
    expect(result.failures).toEqual([]);
  });

  it("trims the fortnight window out of the month it fetches", async () => {
    const client = fakeClient({ "1mo": series(30, 10_000, 100) });
    const result = await runSimulation(client, { ticker: "X", shares: 1, ranges: ["2wk"] });
    // 14 days back from the final bar, inclusive, is 15 bars.
    expect(result.simulations[0].observationCount).toBe(15);
    // ...so the buy price is the 15th-from-last close, not the month's first.
    expect(result.simulations[0].buyPriceCents).toBe(10_000 + 15 * 100);
  });

  it("reports a range with no history as a failure and still returns the others", async () => {
    const client = fakeClient({ "1y": series(200, 8_000, 20), "10y": [] });
    const result = await runSimulation(client, {
      ticker: "X",
      shares: 5,
      ranges: ["1y", "10y"],
    });

    expect(result.simulations.map((s) => s.range)).toEqual(["1y"]);
    expect(result.failures).toEqual([
      { range: "10y", reason: "No price history for this window." },
    ]);
  });

  it("reports a range whose fetch threw, without failing the run", async () => {
    const client = fakeClient({
      "1y": series(200, 8_000, 20),
      "5y": new Error("Yahoo history X: HTTP 502"),
    });
    const result = await runSimulation(client, { ticker: "X", shares: 1, ranges: ["1y", "5y"] });

    expect(result.simulations.map((s) => s.range)).toEqual(["1y"]);
    expect(result.failures[0]).toEqual({ range: "5y", reason: "Yahoo history X: HTTP 502" });
  });

  it("reports a single-close window as too thin rather than simulating it", async () => {
    const client = fakeClient({ "10y": [{ timestamp: 0, closeCents: 100 }] });
    const result = await runSimulation(client, { ticker: "X", shares: 1, ranges: ["10y"] });
    expect(result.simulations).toEqual([]);
    expect(result.failures[0].reason).toBe("Not enough price history for this window.");
  });

  it("throws on invalid input rather than reporting a failed range", async () => {
    const client = fakeClient({ "1y": series(10, 100, 1) });
    await expect(
      runSimulation(client, { ticker: "X", shares: -1, ranges: ["1y"] }),
    ).rejects.toThrow();
  });
});
