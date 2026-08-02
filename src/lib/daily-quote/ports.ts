import type { QuoteWriteData } from "./schema";
import type { DailyQuote } from "./types";

export interface DailyQuoteRepository {
  listQuotes(): DailyQuote[];
  getQuoteById(id: number): DailyQuote | undefined;
  /** Returns one uniformly-random quote, or undefined when the table is empty. */
  getRandomQuote(): DailyQuote | undefined;
  createQuote(input: QuoteWriteData): DailyQuote;
  updateQuote(id: number, input: QuoteWriteData): DailyQuote;
  deleteQuote(id: number): void;
}
