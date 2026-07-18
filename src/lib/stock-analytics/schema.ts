import { z } from "zod";

// riskFreeRate is a fraction (0.05 = 5%), matching the source app's convention.
export const computeSharpeInputSchema = z.object({
  riskFreeRate: z.number().min(0).max(1).default(0.05),
  lookbackDays: z.number().int().positive().default(365),
});

// z.input, not z.infer — both fields have defaults, so callers may omit either.
export type ComputeSharpeInput = z.input<typeof computeSharpeInputSchema>;
