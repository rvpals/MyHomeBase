import { z } from "zod";
import { DEFAULT_TOLERANCE_PCT } from "./types";

/**
 * What a caller asks for, as it arrives from the dialog or from argv.
 *
 * The ticker is upper-cased here rather than at each boundary, so a CLI
 * invocation with `aapl` and a dialog opened on `AAPL` produce the same prompt
 * and the same file name.
 *
 * `tolerancePct` is bounded on both ends because the band is the feature: a 0%
 * band asks for an exact price match and would return nothing, and a band wide
 * enough to admit any stock stops being a constraint at all.
 */
export const tickerConsultOptionsSchema = z.object({
  ticker: z
    .string()
    .trim()
    .min(1, "A ticker is required.")
    .max(20, "That is too long to be a ticker.")
    .transform((value) => value.toUpperCase()),
  tolerancePct: z
    .number()
    .positive("The price band must be wider than zero.")
    .max(50, "A band wider than 50% stops being a price constraint.")
    .default(DEFAULT_TOLERANCE_PCT),
});

export type TickerConsultOptions = z.infer<typeof tickerConsultOptionsSchema>;
