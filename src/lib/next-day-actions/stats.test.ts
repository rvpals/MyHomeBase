import { describe, expect, it } from "vitest";
import { computeScanStats, evaluatePosition, type EvaluatePositionInput } from "./stats";
import type { NextDayActionThresholds } from "./types";

describe("computeScanStats", () => {
  it("computes the 20-day SMA, average volume, and volume ratio over the trailing window", () => {
    const history = Array.from({ length: 25 }, (_, i) => ({ closeCents: 10000, volume: 1000 }));
    history[24] = { closeCents: 10000, volume: 3000 }; // most recent day spikes
    const stats = computeScanStats(history);
    expect(stats.twentyDaySma).toBe(10000);
    expect(stats.closingVolume).toBe(3000);
    expect(stats.avgVolume20Day).toBeCloseTo((19 * 1000 + 3000) / 20, 5);
    expect(stats.volumeRatio).toBeCloseTo(3000 / stats.avgVolume20Day, 5);
  });

  it("only uses the most recent 20 points even when given more", () => {
    const history = [
      ...Array.from({ length: 10 }, () => ({ closeCents: 5000, volume: 100 })),
      ...Array.from({ length: 20 }, () => ({ closeCents: 20000, volume: 500 })),
    ];
    const stats = computeScanStats(history);
    expect(stats.twentyDaySma).toBe(20000);
    expect(stats.avgVolume20Day).toBe(500);
  });

  it("returns zeros for empty history", () => {
    expect(computeScanStats([])).toEqual({
      twentyDaySma: 0,
      avgVolume20Day: 0,
      closingVolume: 0,
      volumeRatio: 0,
    });
  });

  it("returns a zero volume ratio when average volume is zero", () => {
    const stats = computeScanStats([{ closeCents: 100 }, { closeCents: 100 }]);
    expect(stats.volumeRatio).toBe(0);
  });
});

describe("evaluatePosition", () => {
  const thresholds: NextDayActionThresholds = {
    profitTargetPct: 20,
    stockConcentrationCapPct: 10,
    etfConcentrationCapPct: 25,
  };

  const baseInput: EvaluatePositionInput = {
    ticker: "AAPL",
    type: "Stock",
    shares: 10,
    currentPriceCents: 15000,
    positionValueCents: 150000,
    allocationPct: 5,
    costBasisCents: 14000,
    totalReturnPct: 7.1,
    thresholds,
  };

  it("triggers StopLoss when price is below the 20-day SMA, taking priority over everything else", () => {
    const signal = evaluatePosition({
      ...baseInput,
      totalReturnPct: 25, // would otherwise trigger TrimProfit
      allocationPct: 50, // would otherwise trigger Rebalance
      scanStats: { twentyDaySma: 16000, avgVolume20Day: 100, closingVolume: 100, volumeRatio: 1 },
    });
    expect(signal.action).toBe("StopLoss");
  });

  it("triggers TrimProfit when return meets or exceeds the profit target", () => {
    const signal = evaluatePosition({
      ...baseInput,
      totalReturnPct: 20,
      scanStats: { twentyDaySma: 14000, avgVolume20Day: 100, closingVolume: 100, volumeRatio: 1 },
    });
    expect(signal.action).toBe("TrimProfit");
  });

  it("triggers Rebalance when allocation exceeds the type's concentration cap", () => {
    const signal = evaluatePosition({
      ...baseInput,
      allocationPct: 15,
      scanStats: { twentyDaySma: 14000, avgVolume20Day: 100, closingVolume: 100, volumeRatio: 1 },
    });
    expect(signal.action).toBe("Rebalance");
  });

  it("uses the ETF cap instead of the stock cap for ETF positions", () => {
    const signal = evaluatePosition({
      ...baseInput,
      type: "ETF",
      allocationPct: 15, // over the 10% stock cap but under the 25% ETF cap
      scanStats: { twentyDaySma: 14000, avgVolume20Day: 100, closingVolume: 100, volumeRatio: 1 },
    });
    expect(signal.action).toBe("Hold");
  });

  it("triggers StrongBuy on a 1.5x+ volume spike with no other trigger active", () => {
    const signal = evaluatePosition({
      ...baseInput,
      scanStats: { twentyDaySma: 14000, avgVolume20Day: 100, closingVolume: 200, volumeRatio: 2 },
    });
    expect(signal.action).toBe("StrongBuy");
  });

  it("holds when nothing is triggered", () => {
    const signal = evaluatePosition({
      ...baseInput,
      scanStats: { twentyDaySma: 14000, avgVolume20Day: 100, closingVolume: 100, volumeRatio: 1 },
    });
    expect(signal.action).toBe("Hold");
  });

  it("falls back to a two-check evaluation when scan data is unavailable", () => {
    const trimSignal = evaluatePosition({ ...baseInput, totalReturnPct: 20, scanStats: undefined });
    expect(trimSignal.action).toBe("TrimProfit");
    expect(trimSignal.detailLog).toMatch(/Scan data unavailable/);

    const rebalanceSignal = evaluatePosition({ ...baseInput, allocationPct: 15, scanStats: undefined });
    expect(rebalanceSignal.action).toBe("Rebalance");

    const holdSignal = evaluatePosition({ ...baseInput, scanStats: undefined });
    expect(holdSignal.action).toBe("Hold");
  });

  it("also falls back when the SMA itself is zero (insufficient history)", () => {
    const signal = evaluatePosition({
      ...baseInput,
      scanStats: { twentyDaySma: 0, avgVolume20Day: 0, closingVolume: 0, volumeRatio: 0 },
    });
    expect(signal.detailLog).toMatch(/Scan data unavailable/);
  });
});
