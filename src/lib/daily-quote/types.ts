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
  /**
   * Whether this quote is in rotation for the home-screen widget. Stored
   * positive (`is_enabled`, defaulting to on) to match every other flag in the
   * database; the admin screen inverts it to a "Disabled" label, because that is
   * the exception worth naming. A disabled quote is kept in full and still
   * listed in Administration → Daily Quote — it is simply never drawn.
   */
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}
