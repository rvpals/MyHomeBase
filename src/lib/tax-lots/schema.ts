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

/* ---------------------------------------------------------------------------------
   Ad-hoc analysis — a set of transactions passed in, scored, and never stored.

   The stored path answers "how is the position I recorded doing?". This one answers
   "how would THESE purchases look?", which is a different question: the lots arrive
   as input, carry no id, and are gone when the request ends. Both run through the
   same `analyzePortfolio`, so the two screens can never disagree about a figure.
--------------------------------------------------------------------------------- */

/**
 * One transaction as the ad-hoc analyzer takes it.
 *
 * Price is in **dollars** here, not cents — unlike `createTaxLotSchema`. This shape
 * is the boundary for a URL and a CLI flag, where the value is whatever the
 * confirmation printed ("180.50"); cents are a storage concern, converted once
 * inside the use-case. `z.coerce` because both of those sources deliver strings.
 */
export const adhocLotSchema = z.object({
  buyDate: isoDateSchema,
  shares: z.coerce.number().positive("Shares must be greater than zero."),
  pricePerShare: z.coerce.number().nonnegative(),
  // Same default and same reasoning as `createTaxLotSchema`: assume the figures are
  // historical, since that is the case that needs the split table applied.
  isSplitAdjusted: z.coerce.boolean().default(false),
  brokerageFirm: z.string().trim().default(""),
  note: z.string().default(""),
});

export type AdhocLotInput = z.infer<typeof adhocLotSchema>;

/**
 * The whole ad-hoc request: the market context, plus the transactions to score.
 *
 * `min(1)` because an aggregate over nothing is not an analysis — the caller should
 * see an error rather than a screen of zeros that looks like a real flat position.
 * Capped at 200 so a crafted URL can't turn one request into an unbounded loop.
 */
export const analyzeAdhocLotsSchema = z.object({
  ticker: tickerSchema,
  currentMarketPrice: z.coerce.number().nonnegative(),
  trailingEPS: z.coerce.number().default(0),
  today: isoDateSchema,
  lots: z
    .array(adhocLotSchema)
    .min(1, "Pass at least one transaction to analyze.")
    .max(200, "That is more transactions than this screen will analyze at once."),
});

export type AnalyzeAdhocLotsInput = z.infer<typeof analyzeAdhocLotsSchema>;

/**
 * Saving an ad-hoc set into storage. Identical to the analysis input minus the
 * market context, which is only needed to *score* lots, never to record them.
 */
export const saveAdhocLotsSchema = z.object({
  ticker: tickerSchema,
  lots: z.array(adhocLotSchema).min(1).max(200),
});

export type SaveAdhocLotsInput = z.infer<typeof saveAdhocLotsSchema>;

/* ---------------------------------------------------------------------------------
   Multi-ticker ad-hoc analysis — several symbols, each with its own lots.
--------------------------------------------------------------------------------- */

/** One ticker and the transactions being analyzed for it. */
export const tickerLotsSchema = z.object({
  ticker: tickerSchema,
  lots: z.array(adhocLotSchema).min(1).max(200),
});

export type TickerLotsInput = z.infer<typeof tickerLotsSchema>;

/**
 * The multi-ticker request.
 *
 * Capped at 30 tickers: the screen renders a full metric row and lot table per
 * ticker, so this is a readability limit as much as a safety one — past a couple of
 * dozen dividers nobody is reading the sections, they want a portfolio view.
 */
export const multiTickerLotsSchema = z.object({
  today: isoDateSchema,
  tickers: z
    .array(tickerLotsSchema)
    .min(1, "Pick at least one ticker to analyze.")
    .max(30, "That is more tickers than this screen will analyze at once."),
});

export type MultiTickerLotsInput = z.infer<typeof multiTickerLotsSchema>;
