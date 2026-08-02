// The fixed set of categories an admin can assign a quote. This is the single
// source of truth for both the zod schema (validation) and the admin dropdown.
export const QUOTE_CATEGORIES = [
  "Motivation",
  "Inspiration",
  "Wisdom",
  "Success",
  "Happiness",
  "Life",
  "Humor",
  "Love",
] as const;

export type QuoteCategory = (typeof QUOTE_CATEGORIES)[number];

export interface DailyQuote {
  id: number;
  quote: string;
  author: string;
  category: QuoteCategory;
  /** Where the quote came from (book, letter, talk…). Empty when unrecorded. */
  source: string;
  createdAt: string;
  updatedAt: string;
}
