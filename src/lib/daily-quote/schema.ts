import { z } from "zod";
import { QUOTE_CATEGORIES } from "./types";

export const dailyQuoteSchema = z.object({
  id: z.number().int().positive(),
  quote: z.string().min(1),
  author: z.string().min(1),
  category: z.enum(QUOTE_CATEGORIES),
  source: z.string(),
  isEnabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// Blank/whitespace author falls back to "Unknown" rather than failing — a quote
// with no attribution is valid input, an empty author string is not.
const authorPreprocess = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? "Unknown" : value),
  z.string().min(1).default("Unknown"),
);

export const createQuoteSchema = z.object({
  quote: z.string().trim().min(1, "Quote text is required."),
  author: authorPreprocess,
  category: z.enum(QUOTE_CATEGORIES),
  // Optional for callers (a hand-entered quote often has no citation); parse
  // fills in "" so the repository always has a value to write.
  source: z.string().trim().default(""),
  // Optional, defaulting to in-rotation. Every existing caller — the Add Quote
  // screen, the newsletter importer, the CLI — omits it and gets an enabled
  // quote, which is what creating one has always meant.
  isEnabled: z.boolean().default(true),
});

// Input type (what callers pass): `source` and `isEnabled` may be omitted.
export type CreateQuoteInput = z.input<typeof createQuoteSchema>;

// Same shape as create, including `isEnabled`'s default. That default means an
// update which omits the field puts the quote back in rotation — correct for a
// form that always sends the checkbox's state (both QuoteForm call sites do),
// and the reason a status toggle uses `setQuoteEnabled` instead of this.
export const updateQuoteSchema = createQuoteSchema;

export type UpdateQuoteInput = z.input<typeof updateQuoteSchema>;

// Output type (post-parse): every field present. This is what the repository writes.
export type QuoteWriteData = z.output<typeof createQuoteSchema>;
