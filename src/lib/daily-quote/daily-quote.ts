import type { DailyQuoteRepository } from "./ports";
import { createQuoteSchema, updateQuoteSchema } from "./schema";
import type { CreateQuoteInput, UpdateQuoteInput } from "./schema";
import type { DailyQuote } from "./types";

export function listQuotes(repo: DailyQuoteRepository): DailyQuote[] {
  return repo.listQuotes();
}

export function getQuoteById(repo: DailyQuoteRepository, id: number): DailyQuote | undefined {
  return repo.getQuoteById(id);
}

/**
 * The random pick shown on the home screen. Returns undefined when nothing is in
 * rotation — no quotes at all, or every quote disabled. Both mean: show nothing.
 */
export function getRandomQuote(repo: DailyQuoteRepository): DailyQuote | undefined {
  return repo.getRandomQuote();
}

export function createQuote(repo: DailyQuoteRepository, input: CreateQuoteInput): DailyQuote {
  const validated = createQuoteSchema.parse(input);
  return repo.createQuote(validated);
}

export function updateQuote(
  repo: DailyQuoteRepository,
  id: number,
  input: UpdateQuoteInput,
): DailyQuote {
  const validated = updateQuoteSchema.parse(input);
  return repo.updateQuote(id, validated);
}

/**
 * Puts a quote in or out of rotation. A one-column write, not an update of the
 * whole row — see the note on the port.
 */
export function setQuoteEnabled(
  repo: DailyQuoteRepository,
  id: number,
  isEnabled: boolean,
): DailyQuote {
  return repo.setQuoteEnabled(id, isEnabled);
}

export function deleteQuote(repo: DailyQuoteRepository, id: number): void {
  repo.deleteQuote(id);
}
