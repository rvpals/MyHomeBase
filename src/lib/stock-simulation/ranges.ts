// The offered windows, their labels, and the chart interval each one asks for.
//
// Its own file rather than living in `stock-simulation.ts` because `schema.ts`
// needs the list to build its enum and the use-case file imports the schema —
// putting the list beside the use-cases would make that a cycle.

import type { SimulationRange } from "./types";

/** Offered in this order, and every result list is sorted back into it. */
export const SIMULATION_RANGES = [
  "1wk",
  "2wk",
  "1mo",
  "3mo",
  "6mo",
  "1y",
  "2y",
  "5y",
  "10y",
  "max",
] as const;

/** What each range is called on screen. */
export const SIMULATION_RANGE_LABELS: Record<SimulationRange, string> = {
  "1wk": "1 Week",
  "2wk": "2 Weeks",
  "1mo": "1 M",
  "3mo": "3 M",
  "6mo": "6 M",
  "1y": "1 Y",
  "2y": "2 Y",
  "5y": "5 Y",
  "10y": "10 Y",
  max: "MAX",
};

/**
 * What we actually ask the provider for. Two of these aren't the range itself:
 *
 * Yahoo's chart API has no "2wk" range, so a fortnight is fetched as `1mo` and
 * trimmed to the last 14 days here (`TRIM_DAYS_BY_RANGE`). Same for `1wk`,
 * which the API does accept but only alongside intraday intervals — asking for
 * `1wk`/`1d` returns about five bars with the first one often missing, and the
 * buy price *is* that first bar, so it's fetched as `1mo` and trimmed too.
 */
export const PROVIDER_RANGE_BY_RANGE: Record<SimulationRange, string> = {
  "1wk": "1mo",
  "2wk": "1mo",
  "1mo": "1mo",
  "3mo": "3mo",
  "6mo": "6mo",
  "1y": "1y",
  "2y": "2y",
  "5y": "5y",
  "10y": "10y",
  max: "max",
};

/** Ranges fetched wider than they are, and the window to keep, in days. */
export const TRIM_DAYS_BY_RANGE: Partial<Record<SimulationRange, number>> = {
  "1wk": 7,
  "2wk": 14,
};

/**
 * Chart interval per range, following the same reasoning as
 * `INTERVAL_BY_RANGE` in `src/lib/ticker-overview`: ten years of daily closes is
 * ~2,500 points for a chart a few hundred pixels wide, and monthly says the same
 * thing in a fraction of the payload. Below a year, every close matters.
 */
export const INTERVAL_BY_RANGE: Record<SimulationRange, string> = {
  "1wk": "1d",
  "2wk": "1d",
  "1mo": "1d",
  "3mo": "1d",
  "6mo": "1d",
  "1y": "1d",
  "2y": "1wk",
  "5y": "1wk",
  "10y": "1mo",
  max: "1mo",
};

/** Below this many closes a window is too thin to call a simulation. */
export const MINIMUM_OBSERVATIONS = 2;
