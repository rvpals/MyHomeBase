// The Simulation screen from a terminal. Thin adapter: parse argv, hand it to
// the same `runSimulation` use-case the server action calls, print a table.
//
//   npm run cli -- simulate-ticker AAPL --shares 10
//   npm run cli -- simulate-ticker AAPL --shares 10 --ranges 1wk,6mo,1y,max
//
// Ranges default to the screen's default pick. `--ranges all` runs every window.

import { formatCents } from "@/lib/shared/money";
import {
  runSimulation,
  SIMULATION_RANGES,
  SIMULATION_RANGE_LABELS,
  type SimulationRange,
} from "@/lib/stock-simulation";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

const DEFAULT_RANGES = "1mo,6mo,1y";

function signed(cents: number): string {
  return `${cents >= 0 ? "+" : "-"}${formatCents(Math.abs(cents))}`;
}

function pad(value: string, width: number): string {
  return value.padEnd(width);
}

export async function simulateTickerCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  // The ticker is the leading positional, taken before any flag begins — safer
  // than scanning the whole list, where a bare arg could be a flag's value.
  const ticker = args[0]?.startsWith("--") ? undefined : args[0];

  if (!ticker) {
    console.error("Usage: simulate-ticker <TICKER> [--shares N] [--ranges 1wk,6mo,1y|all]");
    console.error(`Ranges: ${SIMULATION_RANGES.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const rangesFlag = flags.ranges ?? DEFAULT_RANGES;
  const ranges =
    rangesFlag === "all"
      ? [...SIMULATION_RANGES]
      : rangesFlag
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);

  let result;
  try {
    // The schema does the validating — an unknown range or a bad share count is
    // rejected here exactly as it is in the web action.
    result = await runSimulation(deps.marketDataClient, {
      ticker,
      shares: Number(flags.shares ?? "1"),
      ranges: ranges as SimulationRange[],
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  console.log(`${result.ticker} — ${result.shares} share(s), bought at each window's start`);
  console.log("Price return only; dividends and fees are not counted.");
  console.log("");
  console.log(
    `  ${pad("RANGE", 9)}${pad("BUY", 12)}${pad("NOW", 12)}${pad("COST", 13)}${pad("VALUE", 13)}GAIN/LOSS`,
  );

  for (const simulation of result.simulations) {
    console.log(
      `  ${pad(SIMULATION_RANGE_LABELS[simulation.range], 9)}` +
        `${pad(formatCents(simulation.buyPriceCents), 12)}` +
        `${pad(formatCents(simulation.currentPriceCents), 12)}` +
        `${pad(formatCents(simulation.totalCostCents), 13)}` +
        `${pad(formatCents(simulation.currentValueCents), 13)}` +
        `${signed(simulation.gainLossCents)} (${simulation.gainLossPct.toFixed(2)}%)`,
    );
  }

  if (result.simulations.length === 0) {
    console.log("  No range returned usable price history.");
  }

  if (result.failures.length > 0) {
    console.log("");
    console.log("UNAVAILABLE");
    for (const failure of result.failures) {
      console.log(`  ${pad(SIMULATION_RANGE_LABELS[failure.range], 9)}${failure.reason}`);
    }
  }
}
