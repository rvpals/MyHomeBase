import { z } from "zod";

/** Boundary validation for a ticker arriving from a form, a URL, or a CLI arg. */
export const newsTickerSchema = z
  .string()
  .trim()
  .min(1, "A ticker is required.")
  .max(12, "That doesn't look like a ticker.")
  // Real symbols are alphanumerics plus dot/hyphen (BRK.B, RDS-A). Anything else is
  // either a typo or an attempt to steer the provider query somewhere else.
  .regex(/^[A-Za-z0-9.\-^]+$/, "A ticker can only contain letters, digits, '.', '-' and '^'.")
  .transform((ticker) => ticker.toUpperCase());

export type NewsTickerInput = z.infer<typeof newsTickerSchema>;
