import { z } from "zod";

/** ISO calendar date, the form every date column in this schema stores. */
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date as YYYY-MM-DD.");

/**
 * A ticker, normalized on the way in.
 *
 * Uppercasing here rather than in the repository is deliberate: the schema is the
 * boundary both adapters share, so `nvda` typed into the CLI and `nvda` posted from
 * a form become the same symbol before any use-case sees them. The split table is
 * keyed by uppercase symbol, so a lower-case leak would silently skip normalization.
 */
const tickerSchema = z
  .string()
  .trim()
  .min(1, "A ticker is required.")
  .max(12)
  .transform((value) => value.toUpperCase());

export const createTaxLotSchema = z.object({
  ticker: tickerSchema,
  buyDate: isoDateSchema,
  // Positive, not just non-negative: a lot of zero shares is not a purchase.
  // Fractional shares are ordinary now, so this is not an integer.
  shares: z.number().positive("Shares must be greater than zero."),
  pricePerShareCents: z.number().int().nonnegative(),
  // Defaults to false — "these are the numbers off the old confirmation" is the
  // case that needs the split table, and defaulting the other way would silently
  // under-report shares on exactly the historical lots this feature exists for.
  isSplitAdjusted: z.boolean().default(false),
  brokerageFirm: z.string().trim().default(""),
  note: z.string().default(""),
});

export type CreateTaxLotInput = z.infer<typeof createTaxLotSchema>;

export const updateTaxLotSchema = createTaxLotSchema;

export type UpdateTaxLotInput = z.infer<typeof updateTaxLotSchema>;

/** Identifies one lot for a read, an update or a delete. */
export const taxLotIdSchema = z.object({
  id: z.number().int().positive(),
});

export type TaxLotIdInput = z.infer<typeof taxLotIdSchema>;

/**
 * The analyzer's inputs — what both the web section and the CLI command parse into.
 *
 * `today` is part of the validated input rather than read from the clock inside the
 * use-case, so the CLI can analyze a position as of any date and the web app can
 * pass the user's local date instead of the server's UTC one.
 */
export const analyzeLotsSchema = z.object({
  ticker: tickerSchema,
  currentMarketPrice: z.number().nonnegative(),
  trailingEPS: z.number().default(0),
  today: isoDateSchema,
});

export type AnalyzeLotsInput = z.infer<typeof analyzeLotsSchema>;

/** A raw lot as an ad-hoc normalization request, for the CLI's `normalize` mode. */
export const normalizeLotSchema = z.object({
  ticker: tickerSchema,
  buyDate: isoDateSchema,
  rawShares: z.number().positive(),
  rawPrice: z.number().nonnegative(),
});

export type NormalizeLotInput = z.infer<typeof normalizeLotSchema>;
