"use server";

import {
  runSimulation,
  runSimulationSchema,
  type SimulationResult,
} from "@/lib/stock-simulation";
import { deps } from "@/lib/wiring";

export interface RunSimulationActionResult {
  ok: boolean;
  error?: string;
  result?: SimulationResult;
}

/**
 * Validate, run, return. No `revalidatePath` — a simulation writes nothing, so
 * there is no server-rendered data to invalidate; the result lives in the view's
 * own state until the next run.
 */
export async function runSimulationAction(input: {
  ticker: string;
  shares: number;
  ranges: string[];
}): Promise<RunSimulationActionResult> {
  const parsed = runSimulationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid simulation input." };
  }

  try {
    return { ok: true, result: await runSimulation(deps.marketDataClient, parsed.data) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to run the simulation.",
    };
  }
}
