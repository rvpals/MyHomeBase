import { describe, expect, it } from "vitest";
import type { CorrelationResult } from "@/lib/stock-analytics";
import {
  GICS_SECTORS,
  MAX_PAIRS,
  describeCorrelation,
  findSectorGaps,
  summarizeCorrelations,
} from "./correlation-insight";

/** A matrix with sane defaults; each test overrides only what it is about. */
function correlationResult(overrides: Partial<CorrelationResult> = {}): CorrelationResult {
  return {
    tickers: ["AAPL", "MSFT", "GLD"],
    matrix: [
      [1, 0.88, -0.12],
      [0.88, 1, -0.05],
      [-0.12, -0.05, 1],
    ],
    marketCorrelation: { AAPL: 0.91, MSFT: 0.87, GLD: -0.08 },
    failedTickers: [],
    calculatedAt: "2026-09-12T10:00:00.000Z",
    ...overrides,
  };
}

const NOW = new Date("2026-09-14T10:00:00.000Z");

function weights(entries: Record<string, number> = { AAPL: 30, MSFT: 20, GLD: 5 }) {
  return new Map(Object.entries(entries));
}

function sectors(entries: Record<string, number> = { Technology: 50, "ETFs & funds": 5 }) {
  return new Map(Object.entries(entries));
}

function summarize(overrides: Partial<Parameters<typeof summarizeCorrelations>[0]> = {}) {
  return summarizeCorrelations({
    correlation: correlationResult(),
    weightByTicker: weights(),
    heldTickers: new Set(["AAPL", "MSFT", "GLD"]),
    sectorWeights: sectors(),
    now: NOW,
    ...overrides,
  });
}

describe("describeCorrelation", () => {
  it("bands a coefficient into the vocabulary the prompt reuses", () => {
    expect(describeCorrelation(-0.5)).toBe("inverse");
    expect(describeCorrelation(-0.1)).toBe("slightly inverse");
    expect(describeCorrelation(0.15)).toBe("largely independent");
    expect(describeCorrelation(0.45)).toBe("loosely coupled");
    expect(describeCorrelation(0.7)).toBe("strongly coupled");
    expect(describeCorrelation(0.95)).toBe("nearly identical");
  });

  it("puts the band boundaries on the lower side", () => {
    expect(describeCorrelation(-0.3)).toBe("inverse");
    expect(describeCorrelation(0)).toBe("largely independent");
    expect(describeCorrelation(0.3)).toBe("loosely coupled");
    expect(describeCorrelation(0.6)).toBe("strongly coupled");
    expect(describeCorrelation(0.85)).toBe("nearly identical");
  });
});

describe("summarizeCorrelations", () => {
  it("reads only unique pairs from the upper triangle", () => {
    const insight = summarize();
    // 3 tickers = 3 unique pairs, not 9 and not 6.
    expect(insight?.pairCount).toBe(3);
  });

  it("ranks the most correlated pair first and the least last", () => {
    const insight = summarize();
    expect(insight?.mostCorrelated[0]).toMatchObject({
      tickerA: "AAPL",
      tickerB: "MSFT",
      correlation: 0.88,
      label: "nearly identical",
    });
    expect(insight?.leastCorrelated[0]).toMatchObject({
      tickerA: "AAPL",
      tickerB: "GLD",
      correlation: -0.12,
    });
  });

  it("adds the two holdings' weights so a pair says how much money it involves", () => {
    const insight = summarize();
    expect(insight?.mostCorrelated[0].combinedWeightPct).toBe(50);
  });

  it("averages every pair, not just the extremes", () => {
    const insight = summarize();
    // (0.88 + -0.12 + -0.05) / 3
    expect(insight?.averagePairwiseCorrelation).toBeCloseTo(0.237, 3);
  });

  it("reports that an inverse pair exists when one does", () => {
    expect(summarize()?.hasInverseCorrelation).toBe(true);
  });

  it("reports no inverse pair for an all-positive equity portfolio", () => {
    const insight = summarize({
      correlation: correlationResult({
        tickers: ["AAPL", "MSFT"],
        matrix: [
          [1, 0.62],
          [0.62, 1],
        ],
        marketCorrelation: { AAPL: 0.9, MSFT: 0.88 },
      }),
      heldTickers: new Set(["AAPL", "MSFT"]),
    });
    expect(insight?.hasInverseCorrelation).toBe(false);
  });

  it("sorts market correlations from most to least market-driven", () => {
    const insight = summarize();
    expect(insight?.marketCorrelations.map((note) => note.ticker)).toEqual(["AAPL", "MSFT", "GLD"]);
  });

  it("drops a market correlation that could not be computed", () => {
    const insight = summarize({
      correlation: correlationResult({
        marketCorrelation: { AAPL: 0.91, MSFT: null, GLD: -0.08 },
      }),
    });
    expect(insight?.marketCorrelations.map((note) => note.ticker)).toEqual(["AAPL", "GLD"]);
  });

  it("caps each list so a large portfolio cannot flood the prompt", () => {
    const tickers = Array.from({ length: 30 }, (_, index) => `T${index}`);
    const matrix = tickers.map((_, i) =>
      tickers.map((_, j) => (i === j ? 1 : 0.1 + ((i + j) % 40) / 100)),
    );
    const insight = summarize({
      correlation: correlationResult({ tickers, matrix, marketCorrelation: {} }),
      weightByTicker: new Map(tickers.map((ticker) => [ticker, 1])),
      heldTickers: new Set(tickers),
    });

    expect(insight?.pairCount).toBe((30 * 29) / 2);
    expect(insight?.mostCorrelated).toHaveLength(MAX_PAIRS);
    expect(insight?.leastCorrelated).toHaveLength(MAX_PAIRS);
  });

  // Taking MAX_PAIRS from each end of a short list would put the same pair in
  // both tables — presenting an inversely correlated pair as a redundancy
  // candidate, which is the opposite of what it is.
  it("never puts the same pair in both lists", () => {
    const key = (pair: { tickerA: string; tickerB: string }) => `${pair.tickerA}-${pair.tickerB}`;

    for (const size of [2, 3, 4, 5, 8, 21]) {
      const tickers = Array.from({ length: size }, (_, index) => `T${index}`);
      const insight = summarize({
        correlation: correlationResult({
          tickers,
          matrix: tickers.map((_, i) =>
            tickers.map((_, j) => (i === j ? 1 : -0.5 + ((i * 7 + j * 3) % 30) / 20)),
          ),
          marketCorrelation: {},
        }),
        weightByTicker: new Map(tickers.map((ticker) => [ticker, 1])),
        heldTickers: new Set(tickers),
      });

      const most = new Set(insight!.mostCorrelated.map(key));
      const overlap = insight!.leastCorrelated.filter((pair) => most.has(key(pair)));
      expect(overlap, `overlap at ${size} tickers`).toEqual([]);
    }
  });

  it("keeps every pair in the most-correlated table on the high side of the split", () => {
    const insight = summarize();
    const lowestOfMost = Math.min(...insight!.mostCorrelated.map((p) => p.correlation));
    const highestOfLeast = Math.max(...insight!.leastCorrelated.map((p) => p.correlation));
    expect(lowestOfMost).toBeGreaterThanOrEqual(highestOfLeast);
  });

  it("puts a lone pair in the most-correlated table only", () => {
    const insight = summarize({
      correlation: correlationResult({
        tickers: ["AAPL", "MSFT"],
        matrix: [
          [1, 0.62],
          [0.62, 1],
        ],
        marketCorrelation: {},
      }),
      heldTickers: new Set(["AAPL", "MSFT"]),
    });
    expect(insight?.mostCorrelated).toHaveLength(1);
    expect(insight?.leastCorrelated).toEqual([]);
  });

  // --- staleness -----------------------------------------------------------

  it("reports a fresh matrix as not stale", () => {
    const insight = summarize();
    expect(insight?.ageDays).toBe(2);
    expect(insight?.isStale).toBe(false);
  });

  it("reports a matrix older than a week as stale but still returns it", () => {
    const insight = summarize({
      correlation: correlationResult({ calculatedAt: "2026-08-01T10:00:00.000Z" }),
    });
    expect(insight?.isStale).toBe(true);
    expect(insight?.mostCorrelated.length).toBeGreaterThan(0);
  });

  it("treats an unreadable timestamp as stale rather than as fresh", () => {
    const insight = summarize({
      correlation: correlationResult({ calculatedAt: "not a date" }),
    });
    expect(insight?.ageDays).toBeNull();
    expect(insight?.isStale).toBe(true);
  });

  it("clamps a future timestamp to zero days rather than reporting negative age", () => {
    const insight = summarize({
      correlation: correlationResult({ calculatedAt: "2026-12-01T10:00:00.000Z" }),
    });
    expect(insight?.ageDays).toBe(0);
  });

  // --- failure and edge paths ---------------------------------------------

  it("returns undefined when the matrix has only one ticker", () => {
    expect(
      summarize({
        correlation: correlationResult({
          tickers: ["AAPL"],
          matrix: [[1]],
          marketCorrelation: { AAPL: 0.9 },
        }),
        heldTickers: new Set(["AAPL"]),
      }),
    ).toBeUndefined();
  });

  it("returns undefined for an empty matrix", () => {
    expect(
      summarize({
        correlation: correlationResult({ tickers: [], matrix: [], marketCorrelation: {} }),
        heldTickers: new Set(),
      }),
    ).toBeUndefined();
  });

  it("drops a ticker that the stale cache still names but the portfolio no longer holds", () => {
    const insight = summarize({ heldTickers: new Set(["AAPL", "MSFT"]) });
    const named = new Set(insight!.mostCorrelated.flatMap((p) => [p.tickerA, p.tickerB]));
    expect(named.has("GLD")).toBe(false);
    expect(insight?.pairCount).toBe(1);
    expect(insight?.marketCorrelations.map((n) => n.ticker)).not.toContain("GLD");
  });

  it("trusts the matrix as given when no held set is supplied", () => {
    const insight = summarize({ heldTickers: undefined });
    expect(insight?.pairCount).toBe(3);
  });

  it("skips a ragged row rather than reading a missing cell as zero correlation", () => {
    const insight = summarize({
      correlation: correlationResult({
        tickers: ["AAPL", "MSFT", "GLD"],
        // MSFT's row is truncated — a corrupt cache, not three zero correlations.
        matrix: [[1, 0.88, -0.12], [0.88], [-0.12, -0.05, 1]],
      }),
    });
    expect(insight?.pairCount).toBe(2);
    expect(
      insight?.mostCorrelated.some((p) => p.tickerA === "MSFT" && p.tickerB === "GLD"),
    ).toBe(false);
  });

  it("skips a NaN cell", () => {
    const insight = summarize({
      correlation: correlationResult({
        matrix: [
          [1, Number.NaN, -0.12],
          [Number.NaN, 1, -0.05],
          [-0.12, -0.05, 1],
        ],
      }),
    });
    expect(insight?.pairCount).toBe(2);
  });

  it("treats a holding with no recorded weight as zero rather than failing", () => {
    const insight = summarize({ weightByTicker: new Map([["AAPL", 30]]) });
    expect(insight?.mostCorrelated[0].combinedWeightPct).toBe(30);
  });

  it("matches tickers case-insensitively and reports them upper-case", () => {
    const insight = summarize({
      correlation: correlationResult({
        tickers: ["aapl", "msft", "gld"],
        marketCorrelation: { aapl: 0.91, msft: 0.87, gld: -0.08 },
      }),
    });
    expect(insight?.mostCorrelated[0].tickerA).toBe("AAPL");
    expect(insight?.marketCorrelations[0].ticker).toBe("AAPL");
  });

  it("carries the tickers that had no price history through to the payload", () => {
    const insight = summarize({
      correlation: correlationResult({ failedTickers: ["xyz", "abc"] }),
    });
    expect(insight?.excludedTickers).toEqual(["ABC", "XYZ"]);
  });

  it("counts only the holdings the matrix actually covers", () => {
    expect(summarize()?.tickerCount).toBe(3);
  });

  // Found against the live portfolio: MSFT is held in both the taxable and the
  // Roth account, so it occupies two matrix columns. Those two columns are the
  // same security and correlate at exactly 1.000, which topped the redundancy
  // table with "MSFT | MSFT | 1.000" — noise where the most actionable finding
  // should be.
  describe("a ticker held in more than one account", () => {
    const duplicated = correlationResult({
      tickers: ["MSFT", "MSFT", "AAPL"],
      matrix: [
        [1, 1, 0.42],
        [1, 1, 0.42],
        [0.42, 0.42, 1],
      ],
      marketCorrelation: { MSFT: 0.87, AAPL: 0.91 },
    });

    it("never pairs that ticker with itself", () => {
      const insight = summarize({
        correlation: duplicated,
        heldTickers: new Set(["MSFT", "AAPL"]),
        weightByTicker: weights({ MSFT: 14, AAPL: 10 }),
      });
      expect(
        insight?.mostCorrelated.some((pair) => pair.tickerA === pair.tickerB),
      ).toBe(false);
    });

    it("counts the duplicated pair once", () => {
      const insight = summarize({
        correlation: duplicated,
        heldTickers: new Set(["MSFT", "AAPL"]),
        weightByTicker: weights({ MSFT: 14, AAPL: 10 }),
      });
      // MSFT-AAPL is the only real pair, even though the matrix offers it twice.
      expect(insight?.pairCount).toBe(1);
      expect(insight?.mostCorrelated).toHaveLength(1);
      expect(insight?.mostCorrelated[0]).toMatchObject({ tickerA: "MSFT", tickerB: "AAPL" });
    });

    it("counts it as one holding, not two", () => {
      const insight = summarize({
        correlation: duplicated,
        heldTickers: new Set(["MSFT", "AAPL"]),
        weightByTicker: weights({ MSFT: 14, AAPL: 10 }),
      });
      expect(insight?.tickerCount).toBe(2);
    });

    it("reports its weight once, not doubled", () => {
      const insight = summarize({
        correlation: duplicated,
        heldTickers: new Set(["MSFT", "AAPL"]),
        weightByTicker: weights({ MSFT: 14, AAPL: 10 }),
      });
      // The aggregated holding already sums both accounts, so 14 + 10.
      expect(insight?.mostCorrelated[0].combinedWeightPct).toBe(24);
    });
  });
});

describe("findSectorGaps", () => {
  it("names a sector with no exposure as absent", () => {
    const gaps = findSectorGaps(new Map([["Technology", 100]]));
    const utilities = gaps.find((gap) => gap.sector === "Utilities");
    expect(utilities).toEqual({ sector: "Utilities", weightPct: 0, status: "absent" });
  });

  it("names a sector below the threshold as thin, not absent", () => {
    const gaps = findSectorGaps(new Map([["Utilities", 1.2]]));
    expect(gaps.find((gap) => gap.sector === "Utilities")).toEqual({
      sector: "Utilities",
      weightPct: 1.2,
      status: "thin",
    });
  });

  it("omits a sector that is comfortably held", () => {
    const gaps = findSectorGaps(new Map([["Technology", 40]]));
    expect(gaps.some((gap) => gap.sector === "Technology")).toBe(false);
  });

  it("does not treat the no-sector labels as a sector of their own", () => {
    const gaps = findSectorGaps(
      new Map([
        ["ETFs & funds", 60],
        ["Unclassified", 10],
      ]),
    );
    expect(gaps.map((gap) => gap.sector)).toEqual(expect.not.arrayContaining(["ETFs & funds", "Unclassified"]));
    // Everything real is still missing, so every GICS sector is a gap.
    expect(gaps).toHaveLength(GICS_SECTORS.length);
  });

  it("reports every sector as a gap for an empty portfolio", () => {
    expect(findSectorGaps(new Map())).toHaveLength(GICS_SECTORS.length);
  });

  it("orders the thinnest gaps first", () => {
    const gaps = findSectorGaps(
      new Map([
        ["Utilities", 2.5],
        ["Energy", 0.5],
      ]),
    );
    const weights = gaps.map((gap) => gap.weightPct);
    expect(weights).toEqual([...weights].sort((a, b) => a - b));
  });

  it("honours a caller-supplied threshold", () => {
    expect(findSectorGaps(new Map([["Utilities", 4]]), 3).some((g) => g.sector === "Utilities")).toBe(
      false,
    );
    expect(findSectorGaps(new Map([["Utilities", 4]]), 5).some((g) => g.sector === "Utilities")).toBe(
      true,
    );
  });

  it("sums two entries that resolve to the same sector", () => {
    const gaps = findSectorGaps(
      new Map([
        ["Energy", 1],
        ["Utilities", 1],
      ]),
    );
    expect(gaps.find((gap) => gap.sector === "Energy")?.weightPct).toBe(1);
  });
});
