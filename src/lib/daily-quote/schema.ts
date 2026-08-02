import { z } from "zod";
import { QUOTE_CATEGORIES } from "./types";

export const dailyQuoteSchema = z.object({
  id: z.number().int().positive(),
  quote: z.string().min(1),
  author: z.string().min(1),
  category: z.enum(QUOTE_CATEGORIES),
  source: z.string(),
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
});

// Input type (what callers pass): `source` may be omitted.
export type CreateQuoteInput = z.input<typeof createQuoteSchema>;

export const updateQuoteSchema = createQuoteSchema;

export type UpdateQuoteInput = z.input<typeof updateQuoteSchema>;

// Output type (post-parse): every field present. This is what the repository writes.
export type QuoteWriteData = z.output<typeof createQuoteSchema>;
