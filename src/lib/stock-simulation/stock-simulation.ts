// The backtest: "had I bought N shares of X at the start of this window and held
// to today, where would I be?" — answered for several windows at once.
//
// Everything except `runSimulation` is a pure function over price points, so the
// arithmetic is tested without a network. `runSimulation` is the only part that
// fetches, and it fetches one window per range in parallel.

import type { MarketDataClient, PricePoint } from "@/lib/market-data";
import {
  INTERVAL_BY_RANGE,
  MINIMUM_OBSERVATIONS,
  PROVIDER_RANGE_BY_RANGE,
  SIMULATION_RANGES,
  TRIM_DAYS_BY_RANGE,
} from "./ranges";
import { runSimulationSchema, type RunSimulationInput } from "./schema";
import type {
  OverlayPoint,
  RangeFailure,
  RangeSimulation,
  SimulationRange,
  SimulationResult,
} from "./types";

const SECONDS_PER_DAY = 86_400;

/**
 * Keep only the last `days` of a series.
 *
 * Measured back from the series' own final close, not from "now": a run on a
 * Sunday would otherwise drop Friday's bar and shorten the window by the length
 * of the weekend. Returns the whole series when nothing needs trimming.
 */
export function trimToRecentDays(points: PricePoint[], days: number): PricePoint[] {
  if (points.length === 0) return points;
  const last = points[points.length - 1];
  const cutoff = last.timestamp - days * SECONDS_PER_DAY;
  const trimmed = points.filter((point) => point.timestamp >= cutoff);
  // A window so short it caught only the final bar isn't a window. Better to
  // report the untrimmed series than a one-point "simulation".
  return trimmed.length >= MINIMUM_OBSERVATIONS ? trimmed : points;
}

/**
 * How many points every normalized series is resampled onto, plus the endpoints.
 *
 * A **fixed, shared grid** rather than each series keeping its own closes. The
 * chart's x-axis is categorical (see `ChartLine`), so rows are laid out evenly
 * by position, not by value — series on different grids would interleave into
 * thousands of one-point rows and each line would be drawn at the wrong x. On
 * one grid every series has a value at every step, so the rows line up and the
 * spacing is honest. 60 steps is finer than the pixel width of any line the
 * chart draws, so nothing visible is lost by resampling to it.
 */
export const OVERLAY_STEPS = 60;

/**
 * Turn one range's closes into a line the overlay can draw beside the others.
 *
 * Both axes are relative, which is the whole point: a 1-week line and a 10-year
 * line share no dates and no price scale, so plotting them raw would squash the
 * short one into a sliver at the right edge. x is progress through the window
 * (0–100), y is percent change from that window's own first close. Every series
 * therefore starts at (0, 0) and ends at (100, its total return).
 *
 * The output is resampled onto `OVERLAY_STEPS` evenly spaced points by nearest
 * close — no interpolation, so every value printed is a price that really
 * traded. A series with fewer closes than steps repeats some of them rather
 * than inventing prices between them.
 */
export function normalizeSeries(points: PricePoint[]): OverlayPoint[] {
  if (points.length === 0) return [];
  const buyPriceCents = points[0].closeCents;
  const lastIndex = points.length - 1;

  const changeAt = (point: PricePoint): number =>
    buyPriceCents === 0 ? 0 : ((point.closeCents - buyPriceCents) / buyPriceCents) * 100;

  // A single close has nowhere to travel; it sits at the start of the axis.
  if (lastIndex === 0) {
    return [
      {
        progressPct: 0,
        changePct: 0,
        closeCents: points[0].closeCents,
        timestamp: points[0].timestamp,
      },
    ];
  }

  return Array.from({ length: OVERLAY_STEPS }, (_, step) => {
    const progress = step / (OVERLAY_STEPS - 1);
    // Nearest real close, so the first and last steps land exactly on the buy
    // and the latest price rather than near them.
    const point = points[Math.round(progress * lastIndex)];
    return {
      progressPct: progress * 100,
      changePct: changeAt(point),
      closeCents: point.closeCents,
      timestamp: point.timestamp,
    };
  });
}

/**
 * One range's figures. `shares` is fractional-safe, so every money value is
 * rounded to whole cents once, at the end — multiplying cents by 0.5 shares
 * otherwise leaves a fraction of a cent travelling through the totals.
 */
export function simulateRange(
  range: SimulationRange,
  points: PricePoint[],
  shares: number,
): RangeSimulation {
  const first = points[0];
  const last = points[points.length - 1];
  const totalCostCents = Math.round(first.closeCents * shares);
  const currentValueCents = Math.round(last.closeCents * shares);
  const gainLossCents = currentValueCents - totalCostCents;

  return {
    range,
    buyPriceCents: first.closeCents,
    currentPriceCents: last.closeCents,
    totalCostCents,
    currentValueCents,
    gainLossCents,
    gainLossPct: totalCostCents === 0 ? 0 : (gainLossCents / totalCostCents) * 100,
    buyTimestamp: first.timestamp,
    currentTimestamp: last.timestamp,
    observationCount: points.length,
    series: normalizeSeries(points),
  };
}

/** Sorts ranges back into the order the screen offers them, whatever order they arrived in. */
function byOfferedOrder<T extends { range: SimulationRange }>(items: T[]): T[] {
  const order = new Map(SIMULATION_RANGES.map((range, index) => [range, index]));
  return [...items].sort((a, b) => (order.get(a.range) ?? 0) - (order.get(b.range) ?? 0));
}

/**
 * Run the backtest across every requested range.
 *
 * Ranges are fetched **in parallel and settled independently**: a symbol younger
 * than one of the windows is the normal case, not an error, so a range with no
 * usable history lands in `failures` and the rest still report. The whole run
 * only throws if the input itself is invalid.
 */
export async function runSimulation(
  client: MarketDataClient,
  input: RunSimulationInput,
): Promise<SimulationResult> {
  const { ticker, shares, ranges } = runSimulationSchema.parse(input);

  const settled = await Promise.all(
    ranges.map(async (range): Promise<RangeSimulation | RangeFailure> => {
      try {
        const history = await client.getHistory(
          ticker,
          PROVIDER_RANGE_BY_RANGE[range],
          INTERVAL_BY_RANGE[range],
        );

        const trimDays = TRIM_DAYS_BY_RANGE[range];
        const points = trimDays === undefined ? history : trimToRecentDays(history, trimDays);

        if (points.length < MINIMUM_OBSERVATIONS) {
          return {
            range,
            reason:
              points.length === 0
                ? "No price history for this window."
                : "Not enough price history for this window.",
          };
        }
        return simulateRange(range, points, shares);
      } catch (error) {
        return { range, reason: error instanceof Error ? error.message : String(error) };
      }
    }),
  );

  const isFailure = (item: RangeSimulation | RangeFailure): item is RangeFailure =>
    "reason" in item;
  const isSimulation = (item: RangeSimulation | RangeFailure): item is RangeSimulation =>
    !isFailure(item);

  return {
    ticker,
    shares,
    ranAt: new Date().toISOString(),
    simulations: byOfferedOrder(settled.filter(isSimulation)),
    failures: byOfferedOrder(settled.filter(isFailure)),
  };
}
