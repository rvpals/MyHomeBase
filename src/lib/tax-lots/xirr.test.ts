import { describe, expect, it } from "vitest";
import { computeXirr } from "./xirr";

/** Re-derives NPV independently of the solver, so a pass is not self-confirming. */
function netPresentValue(flows: { date: string; amount: number }[], rate: number): number {
  const times = flows.map((flow) => Date.parse(`${flow.date}T00:00:00Z`));
  const start = Math.min(...times);
  return flows.reduce((sum, flow, index) => {
    const years = (times[index] - start) / 86_400_000 / 365;
    return sum + flow.amount / (1 + rate) ** years;
  }, 0);
}

describe("computeXirr", () => {
  it("solves a single-period doubling as 100%", () => {
    const rate = computeXirr([
      { date: "2024-01-01", amount: -1000 },
      { date: "2025-01-01", amount: 2000 },
    ]);

    // 2024 is a leap year, so the period is 366 days measured against a 365-day
    // convention — slightly MORE than one year. Doubling over a bit more than a
    // year annualizes to a shade under 100%: 2^(365/366) - 1.
    expect(rate).toBeDefined();
    expect(rate!).toBeCloseTo(2 ** (365 / 366) - 1, 9);
  });

  it("converges on unevenly spaced purchase dates", () => {
    // Four buys at irregular intervals plus a terminal valuation — the real shape
    // of a position accumulated over years.
    const flows = [
      { date: "2019-03-15", amount: -1800 },
      { date: "2020-11-02", amount: -2500 },
      { date: "2022-01-10", amount: -4000 },
      { date: "2024-08-23", amount: -6000 },
      { date: "2026-09-06", amount: 48000 },
    ];

    const rate = computeXirr(flows);

    expect(rate).toBeDefined();
    // The solver's own definition of done: NPV at the returned rate is zero.
    expect(netPresentValue(flows, rate!)).toBeCloseTo(0, 6);
    // Sanity-check the magnitude, so a converged-but-wrong answer is still caught.
    // $14,300 in over seven years becoming $48,000 is roughly 30% a year.
    expect(rate!).toBeGreaterThan(0.25);
    expect(rate!).toBeLessThan(0.35);
  });

  it("converges from a poor initial guess to the same rate", () => {
    const flows = [
      { date: "2019-03-15", amount: -1800 },
      { date: "2022-01-10", amount: -4000 },
      { date: "2026-09-06", amount: 20000 },
    ];

    const fromDefault = computeXirr(flows);
    const fromHighGuess = computeXirr(flows, 5);
    const fromNegativeGuess = computeXirr(flows, -0.5);

    expect(fromDefault).toBeDefined();
    expect(fromHighGuess!).toBeCloseTo(fromDefault!, 6);
    expect(fromNegativeGuess!).toBeCloseTo(fromDefault!, 6);
  });

  it("still solves from a guess far enough out to defeat Newton alone", () => {
    // A guess of 5 (500%) sends the first Newton step past -100%, where the
    // discount term is undefined. Reaching the answer anyway is the bisection
    // fallback doing its job — a poor starting guess must not be the difference
    // between a number and a blank cell.
    const flows = [
      { date: "2018-01-05", amount: -2500 },
      { date: "2021-09-30", amount: -1200 },
      { date: "2026-09-06", amount: 14000 },
    ];

    const rate = computeXirr(flows, 5);

    expect(rate).toBeDefined();
    expect(netPresentValue(flows, rate!)).toBeCloseTo(0, 5);
  });

  it("returns a negative rate for a position that lost money", () => {
    const rate = computeXirr([
      { date: "2023-01-01", amount: -10000 },
      { date: "2026-01-01", amount: 5000 },
    ]);

    expect(rate).toBeDefined();
    expect(rate!).toBeLessThan(0);
    expect(rate!).toBeCloseTo(-0.2062, 3);
  });

  it("returns 0 for a position that exactly broke even", () => {
    const rate = computeXirr([
      { date: "2020-01-01", amount: -5000 },
      { date: "2026-01-01", amount: 5000 },
    ]);

    expect(rate).toBeDefined();
    expect(rate!).toBeCloseTo(0, 6);
  });

  it("handles two purchases on the same date", () => {
    const flows = [
      { date: "2022-01-10", amount: -1000 },
      { date: "2022-01-10", amount: -3000 },
      { date: "2026-01-10", amount: 8000 },
    ];

    const rate = computeXirr(flows);
    expect(rate).toBeDefined();
    expect(netPresentValue(flows, rate!)).toBeCloseTo(0, 6);
  });

  it("is undefined with fewer than two flows", () => {
    expect(computeXirr([])).toBeUndefined();
    expect(computeXirr([{ date: "2024-01-01", amount: -1000 }])).toBeUndefined();
  });

  it("is undefined when every flow has the same sign", () => {
    // Money only ever went in — nothing has been returned, so no rate exists.
    expect(
      computeXirr([
        { date: "2024-01-01", amount: -1000 },
        { date: "2025-01-01", amount: -2000 },
      ]),
    ).toBeUndefined();
  });

  it("is undefined when every flow falls on one date", () => {
    // Zero elapsed time everywhere: every rate is equally consistent, so none is
    // the answer. Reported as undefined rather than 0, which the UI could not
    // distinguish from a genuinely flat return.
    expect(
      computeXirr([
        { date: "2024-01-01", amount: -1000 },
        { date: "2024-01-01", amount: 1500 },
      ]),
    ).toBeUndefined();
  });
});
