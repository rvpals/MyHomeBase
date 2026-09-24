import { describe, expect, it } from "vitest";
import {
  bandCents,
  evaluateMonitor,
  isWithinBand,
  summarizeMonitor,
  valuationFromHoldings,
} from "./evaluate";
import { makeMonitor } from "./fakes";
import type { TickerValuation } from "./types";

/** $10,000 in cents — the worked example from the request. */
const TEN_K = 1_000_000;

function valuation(overrides: Partial<TickerValuation> = {}): TickerValuation {
  return {
    ticker: "NVDA",
    unrealizedGainLossCents: 0,
    // A basis big enough that the default 5% band off cost is wide but finite.
    costCents: 5_000_000,
    ...overrides,
  };
}

describe("isWithinBand", () => {
  it("includes both edges of the band", () => {
    expect(isWithinBand(9_500_00, TEN_K, 50_000)).toBe(true);
    expect(isWithinBand(10_500_00, TEN_K, 50_000)).toBe(true);
  });

  it("excludes a value past the edge", () => {
    expect(isWithinBand(9_499_99, TEN_K, 50_000)).toBe(false);
  });
});

describe("bandCents", () => {
  it("is a percentage of the target", () => {
    // 5% of $10,000 = $500.
    expect(bandCents(makeMonitor({ targetCents: TEN_K, bandPct: 5 }), valuation())).toBe(50_000);
  });

  it("scales with the target, which is why it is a percentage", () => {
    const small = bandCents(makeMonitor({ targetCents: 50_000, bandPct: 5 }), valuation());
    const large = bandCents(makeMonitor({ targetCents: 10_000_000, bandPct: 5 }), valuation());

    expect(small).toBe(2_500);
    expect(large).toBe(500_000);
  });

  it("falls back to cost basis when the target is zero", () => {
    // The break-even case: 5% of a $50,000 basis = $2,500. A band off the
    // target would be 5% of $0, and the monitor could never fire.
    const monitor = makeMonitor({ monitorType: "loss_near_amount", targetCents: 0, bandPct: 5 });

    expect(bandCents(monitor, valuation({ costCents: 5_000_000 }))).toBe(250_000);
  });
});

describe("evaluateMonitor — gain_near_amount", () => {
  const monitor = makeMonitor({ monitorType: "gain_near_amount", targetCents: TEN_K });

  it("fires when the gain is just inside the band", () => {
    // $9,600 against a $10,000 target with a $500 band.
    const result = evaluateMonitor(monitor, valuation({ unrealizedGainLossCents: 960_000 }));

    expect(result.isNear).toBe(true);
    expect(result.shouldNotify).toBe(true);
    expect(result.message).toContain("NVDA");
    expect(result.message).toContain("$9,600.00");
  });

  it("stays quiet when the gain is short of the band", () => {
    expect(
      evaluateMonitor(monitor, valuation({ unrealizedGainLossCents: 900_000 })).isNear,
    ).toBe(false);
  });

  it("fires from above too — approaching is either direction", () => {
    expect(
      evaluateMonitor(monitor, valuation({ unrealizedGainLossCents: 1_030_000 })).isNear,
    ).toBe(true);
  });

  it("stays quiet once well past the target", () => {
    expect(
      evaluateMonitor(monitor, valuation({ unrealizedGainLossCents: 2_000_000 })).isNear,
    ).toBe(false);
  });

  it("never treats a loss as approaching a gain target", () => {
    // Deep in the red. The raw distance to the target is large, but a loss is
    // not an 'almost gain' and reporting it would answer a question nobody asked.
    expect(
      evaluateMonitor(monitor, valuation({ unrealizedGainLossCents: -800_000 })).isNear,
    ).toBe(false);
  });
});

describe("evaluateMonitor — loss_near_amount", () => {
  it("fires as a loss approaches the stated size", () => {
    // Target is stored positive ($2,000) and compared against a negative gain.
    const monitor = makeMonitor({ monitorType: "loss_near_amount", targetCents: 200_000 });

    const result = evaluateMonitor(monitor, valuation({ unrealizedGainLossCents: -195_000 }));

    expect(result.isNear).toBe(true);
    expect(result.message).toContain("loss");
  });

  it("fires near break-even when the target is zero", () => {
    // The headline case: the bad one has nearly recovered. Band is 5% of the
    // $50,000 basis = $2,500, so a $1,000 loss is inside it.
    const monitor = makeMonitor({ monitorType: "loss_near_amount", targetCents: 0 });

    const result = evaluateMonitor(monitor, valuation({ unrealizedGainLossCents: -100_000 }));

    expect(result.isNear).toBe(true);
    expect(result.message).toContain("breaking even");
  });

  it("says 'recovered' rather than 'approaching $0.00' once back in the black", () => {
    const monitor = makeMonitor({ monitorType: "loss_near_amount", targetCents: 0 });

    const result = evaluateMonitor(monitor, valuation({ unrealizedGainLossCents: 50_000 }));

    expect(result.isNear).toBe(true);
    expect(result.message).toContain("recovered to break even");
  });

  it("stays quiet on a loss far from break-even", () => {
    const monitor = makeMonitor({ monitorType: "loss_near_amount", targetCents: 0 });

    expect(
      evaluateMonitor(monitor, valuation({ unrealizedGainLossCents: -2_000_000 })).isNear,
    ).toBe(false);
  });
});

describe("evaluateMonitor — gain_near_pct_of_cost", () => {
  const monitor = makeMonitor({
    monitorType: "gain_near_pct_of_cost",
    targetCents: 0,
    targetPct: 20,
  });

  it("fires as the gain approaches the percentage of basis", () => {
    // 20% of a $50,000 basis is $10,000; band is 5% of that target = $500.
    const result = evaluateMonitor(monitor, valuation({ unrealizedGainLossCents: 970_000 }));

    expect(result.isNear).toBe(true);
    expect(result.message).toContain("19.4%");
    expect(result.message).toContain("20% target");
  });

  it("stays quiet well below the target percentage", () => {
    expect(
      evaluateMonitor(monitor, valuation({ unrealizedGainLossCents: 100_000 })).isNear,
    ).toBe(false);
  });

  it("cannot be judged without a cost basis", () => {
    expect(
      evaluateMonitor(monitor, valuation({ costCents: 0, unrealizedGainLossCents: 500_000 }))
        .isNear,
    ).toBe(false);
  });
});

describe("evaluateMonitor — the latch and the guards", () => {
  const monitor = makeMonitor({ monitorType: "gain_near_amount", targetCents: TEN_K });
  const inBand = valuation({ unrealizedGainLossCents: 990_000 });

  it("notifies on the way in, then stays quiet while it holds", () => {
    const first = evaluateMonitor(monitor, inBand);
    expect(first.isNear).toBe(true);
    expect(first.shouldNotify).toBe(true);

    // Same condition, latch now set: still true, but nothing more to file.
    const second = evaluateMonitor({ ...monitor, isTriggered: true }, inBand);
    expect(second.isNear).toBe(true);
    expect(second.shouldNotify).toBe(false);
  });

  it("is silent and un-flagged when disabled", () => {
    const result = evaluateMonitor({ ...monitor, isEnabled: false }, inBand);

    expect(result.isNear).toBe(false);
    expect(result.shouldNotify).toBe(false);
  });

  it("never fires against an unknown cost basis", () => {
    // costCents 0 means unknown, not free — firing would report a gain equal
    // to the entire market value.
    const result = evaluateMonitor(monitor, valuation({ costCents: 0, unrealizedGainLossCents: 990_000 }));

    expect(result.isNear).toBe(false);
  });
});

describe("valuationFromHoldings", () => {
  it("sums every account holding the ticker", () => {
    const result = valuationFromHoldings("NVDA", [
      { unrealizedGainLossCents: 300_000, costCents: 1_000_000 },
      { unrealizedGainLossCents: 200_000, costCents: 2_000_000 },
    ]);

    expect(result).toEqual({
      ticker: "NVDA",
      unrealizedGainLossCents: 500_000,
      costCents: 3_000_000,
    });
  });

  it("ignores the gain on a holding with no known basis", () => {
    // Matches computePortfolioSummary: a partial basis must not be divided
    // into a whole gain.
    const result = valuationFromHoldings("NVDA", [
      { unrealizedGainLossCents: 300_000, costCents: 1_000_000 },
      { unrealizedGainLossCents: 999_999, costCents: 0 },
    ]);

    expect(result.unrealizedGainLossCents).toBe(300_000);
    expect(result.costCents).toBe(1_000_000);
  });

  it("is zeroed when nothing is held", () => {
    expect(valuationFromHoldings("NVDA", [])).toEqual({
      ticker: "NVDA",
      unrealizedGainLossCents: 0,
      costCents: 0,
    });
  });
});

describe("summarizeMonitor", () => {
  it("describes each type in the reader's words", () => {
    expect(summarizeMonitor(makeMonitor({ targetCents: TEN_K }))).toBe(
      "Unrealized gain near $10,000.00",
    );
    expect(
      summarizeMonitor(makeMonitor({ monitorType: "loss_near_amount", targetCents: 0 })),
    ).toBe("Unrealized loss near break-even");
    expect(
      summarizeMonitor(
        makeMonitor({ monitorType: "gain_near_pct_of_cost", targetCents: 0, targetPct: 20 }),
      ),
    ).toBe("Unrealized gain near 20% of cost basis");
  });
});
