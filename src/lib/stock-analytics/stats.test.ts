import { describe, expect, it } from "vitest";
import {
  alignSeriesByTimestamp,
  annualizeReturn,
  annualizeStdDev,
  classifyVolatility,
  computePortfolioDailyReturns,
  computePortfolioWeights,
  computeRangePositionPct,
  computeSharpeRatio,
  computeVolatilityStats,
  dailyLogReturns,
  dailyReturns,
  dailyRiskFreeRate,
  lookbackDaysToYahooRange,
  pearsonCorrelation,
} from "./stats";

describe("dailyReturns", () => {
  it("computes simple day-over-day returns", () => {
    expect(dailyReturns([100, 110, 99])).toEqual([0.1, -0.1]);
  });

  it("skips a step where the prior close is zero", () => {
    expect(dailyReturns([0, 100])).toEqual([]);
  });

  it("returns an empty array for fewer than 2 points", () => {
    expect(dailyReturns([100])).toEqual([]);
    expect(dailyReturns([])).toEqual([]);
  });
});

describe("dailyLogReturns", () => {
  it("computes log returns", () => {
    const [first] = dailyLogReturns([100, 110]);
    expect(first).toBeCloseTo(Math.log(1.1), 10);
  });

  it("skips a step where the prior close is not positive", () => {
    expect(dailyLogReturns([0, 100])).toEqual([]);
    expect(dailyLogReturns([-5, 100])).toEqual([]);
  });
});

describe("pearsonCorrelation", () => {
  it("returns 1 for perfectly correlated series", () => {
    expect(pearsonCorrelation([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 10);
  });

  it("returns -1 for perfectly anti-correlated series", () => {
    expect(pearsonCorrelation([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 10);
  });

  it("returns null for fewer than 2 points", () => {
    expect(pearsonCorrelation([1], [2])).toBeNull();
  });

  it("returns null when a series has zero variance", () => {
    expect(pearsonCorrelation([1, 1, 1], [1, 2, 3])).toBeNull();
  });

  it("truncates to the shorter series' length", () => {
    expect(pearsonCorrelation([1, 2, 3, 4, 5], [1, 2, 3])).toBeCloseTo(1, 10);
  });
});

describe("computeVolatilityStats", () => {
  it("returns zeros for fewer than 2 closes", () => {
    expect(computeVolatilityStats([100])).toEqual({ annualizedVolPct: 0, dailyStdDevPct: 0 });
    expect(computeVolatilityStats([])).toEqual({ annualizedVolPct: 0, dailyStdDevPct: 0 });
  });

  it("returns zero volatility for a perfectly flat series", () => {
    const stats = computeVolatilityStats([100, 100, 100, 100]);
    expect(stats.dailyStdDevPct).toBeCloseTo(0, 10);
    expect(stats.annualizedVolPct).toBeCloseTo(0, 10);
  });

  it("scales annualized volatility by sqrt(252) over daily", () => {
    const stats = computeVolatilityStats([100, 105, 98, 110, 95, 108]);
    expect(stats.annualizedVolPct).toBeCloseTo(stats.dailyStdDevPct * Math.sqrt(252), 6);
  });
});

describe("classifyVolatility", () => {
  it("labels the four bands correctly", () => {
    expect(classifyVolatility(5)).toBe("Low");
    expect(classifyVolatility(20)).toBe("Moderate");
    expect(classifyVolatility(45)).toBe("High");
    expect(classifyVolatility(75)).toBe("Very High");
  });

  it("treats the band boundaries as exclusive on the upper end", () => {
    expect(classifyVolatility(14.99)).toBe("Low");
    expect(classifyVolatility(15)).toBe("Moderate");
    expect(classifyVolatility(29.99)).toBe("Moderate");
    expect(classifyVolatility(30)).toBe("High");
  });
});

describe("computeRangePositionPct", () => {
  it("computes where the price sits within the range", () => {
    expect(computeRangePositionPct(75, 50, 100)).toBe(50);
    expect(computeRangePositionPct(50, 50, 100)).toBe(0);
    expect(computeRangePositionPct(100, 50, 100)).toBe(100);
  });

  it("clamps outside the range", () => {
    expect(computeRangePositionPct(200, 50, 100)).toBe(100);
    expect(computeRangePositionPct(10, 50, 100)).toBe(0);
  });

  it("returns 50 when high <= low", () => {
    expect(computeRangePositionPct(75, 100, 100)).toBe(50);
    expect(computeRangePositionPct(75, 100, 50)).toBe(50);
  });
});

describe("alignSeriesByTimestamp", () => {
  it("inner-joins on shared timestamps, sorted ascending", () => {
    const result = alignSeriesByTimestamp({
      AAPL: [
        { timestamp: 2, closeCents: 200 },
        { timestamp: 1, closeCents: 100 },
        { timestamp: 3, closeCents: 300 },
      ],
      SPY: [
        { timestamp: 1, closeCents: 1000 },
        { timestamp: 2, closeCents: 2000 },
      ],
    });
    expect(result.timestamps).toEqual([1, 2]);
    expect(result.closesByTicker.AAPL).toEqual([100, 200]);
    expect(result.closesByTicker.SPY).toEqual([1000, 2000]);
  });

  it("returns empty for no tickers", () => {
    expect(alignSeriesByTimestamp({})).toEqual({ timestamps: [], closesByTicker: {} });
  });
});

describe("computePortfolioWeights", () => {
  it("weights holdings by position value", () => {
    const weights = computePortfolioWeights([
      { ticker: "AAPL", shares: 10, priceCents: 10000 },
      { ticker: "SPY", shares: 2, priceCents: 20000 },
    ]);
    expect(weights.AAPL).toBeCloseTo(100000 / 140000, 10);
    expect(weights.SPY).toBeCloseTo(40000 / 140000, 10);
  });

  it("excludes zero/negative shares or prices", () => {
    const weights = computePortfolioWeights([
      { ticker: "AAPL", shares: 10, priceCents: 10000 },
      { ticker: "DEAD", shares: 0, priceCents: 5000 },
    ]);
    expect(weights).toEqual({ AAPL: 1 });
  });

  it("returns an empty object when total value is zero", () => {
    expect(computePortfolioWeights([])).toEqual({});
  });
});

describe("computePortfolioDailyReturns", () => {
  it("value-weights per-ticker return series", () => {
    const result = computePortfolioDailyReturns(
      { AAPL: [0.1, -0.1], SPY: [0.02, 0.02] },
      { AAPL: 0.5, SPY: 0.5 },
    );
    expect(result[0]).toBeCloseTo(0.06, 10);
    expect(result[1]).toBeCloseTo(-0.04, 10);
  });

  it("truncates to the shortest ticker series", () => {
    const result = computePortfolioDailyReturns({ AAPL: [0.1, -0.1, 0.05], SPY: [0.02] }, { AAPL: 0.5, SPY: 0.5 });
    expect(result).toHaveLength(1);
  });

  it("returns an empty array when no ticker has a weight", () => {
    expect(computePortfolioDailyReturns({ AAPL: [0.1] }, {})).toEqual([]);
  });
});

describe("annualizeReturn / annualizeStdDev / computeSharpeRatio", () => {
  it("annualizes mean daily return by trading days per year", () => {
    expect(annualizeReturn([0.01, 0.01, 0.01])).toBeCloseTo(0.01 * 252, 10);
  });

  it("returns zero annualized return for an empty series", () => {
    expect(annualizeReturn([])).toBe(0);
  });

  it("returns zero annualized stdev for fewer than 2 points", () => {
    expect(annualizeStdDev([0.01])).toBe(0);
  });

  it("computes a Sharpe ratio rounded to 2 decimals", () => {
    expect(computeSharpeRatio(0.12, 0.05, 0.2)).toBe(0.35);
  });

  it("returns null Sharpe when volatility is zero", () => {
    expect(computeSharpeRatio(0.1, 0.05, 0)).toBeNull();
  });

  it("converts an annual risk-free rate to a daily one", () => {
    expect(dailyRiskFreeRate(0.05)).toBeCloseTo(0.05 / 252, 10);
  });
});

describe("lookbackDaysToYahooRange", () => {
  it("maps calendar-day windows to the right Yahoo range", () => {
    expect(lookbackDaysToYahooRange(90)).toBe("6mo");
    expect(lookbackDaysToYahooRange(365)).toBe("1y");
    expect(lookbackDaysToYahooRange(700)).toBe("2y");
    expect(lookbackDaysToYahooRange(1800)).toBe("5y");
    expect(lookbackDaysToYahooRange(3650)).toBe("10y");
  });
});
