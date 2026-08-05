import { z } from "zod";

/**
 * The boundary schema for the three scan thresholds. Each is a percentage, so
 * anything at or below zero would make its rule fire on every position (or never),
 * and the 100 cap stops a typo like `2000` from silently disabling a rule.
 */
export const nextDayActionThresholdsSchema = z.object({
  profitTargetPct: z.number().positive().max(100),
  stockConcentrationCapPct: z.number().positive().max(100),
  etfConcentrationCapPct: z.number().positive().max(100),
});

export type NextDayActionThresholdsInput = z.infer<typeof nextDayActionThresholdsSchema>;
