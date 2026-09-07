import { describe, expect, it } from "vitest";
import {
  cumulativeSplitFactor,
  normalizeLot,
  passthroughLot,
  splitHistoryFor,
  splitsAppliedTo,
  tickersWithSplits,
} from "./splits";

// NVDA is the worked example throughout: 4:1 on 2021-07-20, then 10:1 on
// 2024-06-07. That gives three eras and three different factors, which is exactly
// the case that goes wrong when the "strictly after" rule is got wrong.
const NVDA = splitHistoryFor("NVDA");

describe("splitHistoryFor", () => {
  it("finds a ticker's splits regardless of the case it is written in", () => {
    expect(splitHistoryFor("nvda").splits).toHaveLength(2);
    expect(splitHistoryFor("  NvDa  ").ticker).toBe("NVDA");
  });

  it("reports a ticker that never split as an empty history, not undefined", () => {
    const history = splitHistoryFor("KO");
    expect(history.ticker).toBe("KO");
    expect(history.splits).toEqual([]);
  });

  it("lists the known tickers", () => {
    expect(tickersWithSplits()).toContain("NVDA");
  });
});

describe("cumulativeSplitFactor", () => {
  it("applies both splits to a pre-2021 lot", () => {
    expect(cumulativeSplitFactor("2019-03-15", NVDA)).toBe(40);
  });

  it("applies only the 2024 split to a lot bought between the two", () => {
    expect(cumulativeSplitFactor("2022-01-10", NVDA)).toBe(10);
  });

  it("applies nothing to a post-2024 lot", () => {
    expect(cumulativeSplitFactor("2025-01-02", NVDA)).toBe(1);
  });

  it("excludes a split effective on the buy date itself", () => {
    // Shares bought on the effective date already trade post-split. Counting it
    // would report 4x the shares actually held.
    expect(cumulativeSplitFactor("2021-07-20", NVDA)).toBe(10);
    expect(cumulativeSplitFactor("2024-06-07", NVDA)).toBe(1);
  });

  it("includes a split effective the day after the buy date", () => {
    expect(cumulativeSplitFactor("2024-06-06", NVDA)).toBe(10);
  });

  it("is 1 for a ticker with no splits", () => {
    expect(cumulativeSplitFactor("2010-01-01", splitHistoryFor("KO"))).toBe(1);
  });
});

describe("splitsAppliedTo", () => {
  it("names the splits that hit a pre-2021 lot, oldest first", () => {
    expect(splitsAppliedTo("2019-03-15", NVDA).map((split) => split.label)).toEqual([
      "4:1",
      "10:1",
    ]);
  });

  it("returns nothing for a lot bought after the last split", () => {
    expect(splitsAppliedTo("2025-01-02", NVDA)).toEqual([]);
  });
});

describe("normalizeLot — multi-lot split normalization", () => {
  it("restates a pre-2021 lot in today's shares", () => {
    // 10 shares at $180 in 2019 → 400 shares at $4.50 after 4:1 and 10:1.
    const result = normalizeLot({ buyDate: "2019-03-15", rawShares: 10, rawPrice: 180 }, NVDA);

    expect(result.cumulativeSplitFactor).toBe(40);
    expect(result.adjustedShares).toBe(400);
    expect(result.adjustedCostPerShare).toBeCloseTo(4.5, 10);
    expect(result.costBasis).toBeCloseTo(1800, 10);
  });

  it("restates a 2021–2024 lot with only the later split", () => {
    // 20 shares at $200 in 2022 → 200 shares at $20 after the 10:1 alone.
    const result = normalizeLot({ buyDate: "2022-01-10", rawShares: 20, rawPrice: 200 }, NVDA);

    expect(result.cumulativeSplitFactor).toBe(10);
    expect(result.adjustedShares).toBe(200);
    expect(result.adjustedCostPerShare).toBeCloseTo(20, 10);
    expect(result.costBasis).toBeCloseTo(4000, 10);
  });

  it("leaves a post-2024 lot exactly as bought", () => {
    const result = normalizeLot({ buyDate: "2025-01-02", rawShares: 50, rawPrice: 140 }, NVDA);

    expect(result.cumulativeSplitFactor).toBe(1);
    expect(result.adjustedShares).toBe(50);
    expect(result.adjustedCostPerShare).toBe(140);
    expect(result.costBasis).toBeCloseTo(7000, 10);
  });

  it("preserves cost basis across every era — a split moves no money", () => {
    // The invariant the whole normalization rests on. Asserted with toBeCloseTo
    // because multiplying then dividing by the factor is not bit-exact in floats.
    const lots = [
      { buyDate: "2019-03-15", rawShares: 10, rawPrice: 180 },
      { buyDate: "2021-07-20", rawShares: 15, rawPrice: 47.5 },
      { buyDate: "2022-01-10", rawShares: 20, rawPrice: 200 },
      { buyDate: "2025-01-02", rawShares: 50, rawPrice: 140 },
    ];

    for (const lot of lots) {
      const result = normalizeLot(lot, NVDA);
      expect(result.costBasis).toBeCloseTo(lot.rawShares * lot.rawPrice, 8);
    }
  });

  it("keeps fractional shares fractional", () => {
    const result = normalizeLot({ buyDate: "2022-01-10", rawShares: 1.5, rawPrice: 250 }, NVDA);
    expect(result.adjustedShares).toBeCloseTo(15, 10);
    expect(result.costBasis).toBeCloseTo(375, 10);
  });

  it("handles a reverse split as a fractional ratio", () => {
    // Not in the shipped table — constructed here so the ratio contract is covered
    // without waiting for a reverse split to be added.
    const reverse = {
      ticker: "RVRS",
      splits: [{ effectiveDate: "2023-01-10", ratio: 0.1, label: "1:10" }],
    };
    const result = normalizeLot({ buyDate: "2020-01-01", rawShares: 100, rawPrice: 3 }, reverse);

    expect(result.adjustedShares).toBeCloseTo(10, 10);
    expect(result.adjustedCostPerShare).toBeCloseTo(30, 10);
    expect(result.costBasis).toBeCloseTo(300, 10);
  });
});

describe("passthroughLot", () => {
  it("reports a factor of 1 and scales nothing", () => {
    const result = passthroughLot({ buyDate: "2019-03-15", rawShares: 400, rawPrice: 4.5 });

    expect(result.cumulativeSplitFactor).toBe(1);
    expect(result.adjustedShares).toBe(400);
    expect(result.adjustedCostPerShare).toBe(4.5);
    expect(result.costBasis).toBeCloseTo(1800, 10);
  });

  it("agrees with normalizeLot once the split table has been applied", () => {
    // An already-adjusted 2019 lot and a raw one describe the same position.
    const raw = normalizeLot({ buyDate: "2019-03-15", rawShares: 10, rawPrice: 180 }, NVDA);
    const adjusted = passthroughLot({
      buyDate: "2019-03-15",
      rawShares: 400,
      rawPrice: 4.5,
    });

    expect(adjusted.adjustedShares).toBeCloseTo(raw.adjustedShares, 8);
    expect(adjusted.costBasis).toBeCloseTo(raw.costBasis, 8);
  });
});
