import { z } from "zod";
import { SIMULATION_RANGES } from "./ranges";

/**
 * The boundary shape for a run. Both the server action and the CLI parse raw
 * input through this, so a bad share count is rejected identically in each.
 *
 * Unlike `historyRequestSchema` in market-data — which keeps range a free string
 * because the vocabulary there is the provider's — this one is a closed enum.
 * The ranges here are *this screen's* offer, not Yahoo's whole catalogue, and
 * each maps to an interval we picked; an unrecognised one has no mapping.
 */
export const runSimulationSchema = z.object({
  ticker: z
    .string()
    .trim()
    .min(1, "Enter a ticker.")
    .max(20)
    .transform((value) => value.toUpperCase()),
  // Fractional shares are real (brokers sell them), so this isn't an integer.
  shares: z
    .number()
    .refine(Number.isFinite, "Enter a number of shares.")
    .positive("Shares must be greater than zero."),
  ranges: z
    .array(z.enum(SIMULATION_RANGES))
    .min(1, "Pick at least one time range.")
    // The same range twice is one range, not two identical cards.
    .transform((values) => Array.from(new Set(values))),
});

export type RunSimulationInput = z.infer<typeof runSimulationSchema>;
