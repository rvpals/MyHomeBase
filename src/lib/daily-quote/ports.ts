import type { QuoteWriteData } from "./schema";
import type { DailyQuote } from "./types";

export interface DailyQuoteRepository {
  listQuotes(): DailyQuote[];
  getQuoteById(id: number): DailyQuote | undefined;
  /**
   * Returns one uniformly-random *enabled* quote, or undefined when no quote is
   * in rotation — which covers both an empty table and one where every quote has
   * been disabled. Callers treat those identically: show nothing.
   */
  getRandomQuote(): DailyQuote | undefined;
  createQuote(input: QuoteWriteData): DailyQuote;
  updateQuote(id: number, input: QuoteWriteData): DailyQuote;
  /**
   * Writes the rotation flag alone. Deliberately not expressed as an
   * `updateQuote` of unchanged fields: that would let a toggle clobber an edit
   * made elsewhere between render and click, and would route a one-column change
   * through a validator that demands non-empty quote text.
   */
  setQuoteEnabled(id: number, isEnabled: boolean): DailyQuote;
  deleteQuote(id: number): void;
}
