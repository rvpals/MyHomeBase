import { z } from "zod";

/**
 * A symbol arriving at the favorite boundary.
 *
 * Stricter than the search box's query schema, and for the opposite reason: this
 * one is *stored*, so a stray character would become a row that no quote lookup
 * can ever resolve. The shape follows what the app already accepts as a ticker —
 * letters, digits, and the `.`/`-` that appear in class shares and some exchanges
 * (`BRK.B`, `RDS-A`). The bounds match `TICKER_PATTERN` in `ticker-profiles`, so a
 * symbol this module accepts is one that module can look up; two different limits
 * would mean a favorite no quote fetch can resolve.
 */
export const favoriteTickerSchema = z
  .string()
  .trim()
  .min(1)
  .max(15)
  .regex(/^[A-Za-z0-9.-]+$/, "A ticker is letters, digits, dots and hyphens.");
