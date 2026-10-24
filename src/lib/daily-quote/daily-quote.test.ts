import { describe, expect, it } from "vitest";
import {
  createQuote,
  deleteQuote,
  getRandomQuote,
  listQuotes,
  setQuoteEnabled,
  updateQuote,
} from "./daily-quote";
import type { DailyQuoteRepository } from "./ports";
import type { QuoteWriteData } from "./schema";
import type { DailyQuote } from "./types";

// In-memory fake implementing the port — lets us test use-cases with no real DB.
// Takes QuoteWriteData (the parsed shape a repository receives), not the looser
// caller-facing input type.
class FakeDailyQuoteRepository implements DailyQuoteRepository {
  private rows: DailyQuote[] = [];
  private nextId = 1;
  public createCalls: QuoteWriteData[] = [];

  listQuotes(): DailyQuote[] {
    return [...this.rows];
  }
  getQuoteById(id: number): DailyQuote | undefined {
    return this.rows.find((row) => row.id === id);
  }
  // Mirrors the real repository's `WHERE is_enabled = 1`. A fake that drew from
  // every row would let a broken filter pass these tests.
  getRandomQuote(): DailyQuote | undefined {
    const inRotation = this.rows.filter((row) => row.isEnabled);
    if (inRotation.length === 0) return undefined;
    return inRotation[Math.floor(Math.random() * inRotation.length)];
  }
  createQuote(input: QuoteWriteData): DailyQuote {
    this.createCalls.push(input);
    const row: DailyQuote = {
      id: this.nextId++,
      quote: input.quote,
      author: input.author,
      category: input.category,
      source: input.source,
      isEnabled: input.isEnabled,
      createdAt: "2026-07-26",
      updatedAt: "2026-07-26",
    };
    this.rows.push(row);
    return row;
  }
  updateQuote(id: number, input: QuoteWriteData): DailyQuote {
    const row = this.getQuoteById(id);
    if (!row) throw new Error(`No quote ${id}`);
    Object.assign(row, input);
    return row;
  }
  setQuoteEnabled(id: number, isEnabled: boolean): DailyQuote {
    const row = this.getQuoteById(id);
    if (!row) throw new Error(`No quote ${id}`);
    row.isEnabled = isEnabled;
    return row;
  }
  deleteQuote(id: number): void {
    this.rows = this.rows.filter((row) => row.id !== id);
  }
}

describe("daily-quote use-cases", () => {
  it("creates a quote from valid input", () => {
    const repo = new FakeDailyQuoteRepository();
    const created = createQuote(repo, {
      quote: "Stay hungry, stay foolish.",
      author: "Steve Jobs",
      category: "Motivation",
    });
    expect(created.id).toBe(1);
    expect(repo.createCalls).toHaveLength(1);
    expect(listQuotes(repo)).toHaveLength(1);
  });

  it("defaults a blank author to 'Unknown'", () => {
    const repo = new FakeDailyQuoteRepository();
    const created = createQuote(repo, { quote: "Carpe diem.", author: "   ", category: "Life" });
    expect(created.author).toBe("Unknown");
  });

  it("rejects an empty quote", () => {
    const repo = new FakeDailyQuoteRepository();
    expect(() =>
      createQuote(repo, { quote: "   ", author: "Anon", category: "Wisdom" }),
    ).toThrow();
  });

  it("rejects a category outside the fixed list", () => {
    const repo = new FakeDailyQuoteRepository();
    expect(() =>
      // @ts-expect-error — deliberately invalid category to prove the schema guards it
      createQuote(repo, { quote: "Hi", author: "Anon", category: "NotACategory" }),
    ).toThrow();
  });

  it("returns undefined for a random quote when the table is empty", () => {
    const repo = new FakeDailyQuoteRepository();
    expect(getRandomQuote(repo)).toBeUndefined();
  });

  it("creates a quote in rotation by default", () => {
    const repo = new FakeDailyQuoteRepository();
    const created = createQuote(repo, { quote: "Keep going.", author: "A", category: "Motivation" });
    expect(created.isEnabled).toBe(true);
  });

  it("never draws a disabled quote", () => {
    const repo = new FakeDailyQuoteRepository();
    const shown = createQuote(repo, { quote: "Shown", author: "A", category: "Life" });
    const hidden = createQuote(repo, { quote: "Hidden", author: "B", category: "Life" });
    setQuoteEnabled(repo, hidden.id, false);

    // Drawn repeatedly because the pick is random — one draw could miss the
    // disabled quote by luck rather than by the filter working.
    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(getRandomQuote(repo)?.id).toBe(shown.id);
    }
  });

  it("returns undefined when every quote is disabled", () => {
    const repo = new FakeDailyQuoteRepository();
    const only = createQuote(repo, { quote: "Alone", author: "A", category: "Wisdom" });
    setQuoteEnabled(repo, only.id, false);

    expect(getRandomQuote(repo)).toBeUndefined();
    // Still in the library, and still listed for the admin grid.
    expect(listQuotes(repo)).toHaveLength(1);
  });

  it("puts a disabled quote back into rotation", () => {
    const repo = new FakeDailyQuoteRepository();
    const created = createQuote(repo, { quote: "Back", author: "A", category: "Success" });
    expect(setQuoteEnabled(repo, created.id, false).isEnabled).toBe(false);
    expect(setQuoteEnabled(repo, created.id, true).isEnabled).toBe(true);
    expect(getRandomQuote(repo)?.id).toBe(created.id);
  });

  it("fails to change the status of a quote that does not exist", () => {
    const repo = new FakeDailyQuoteRepository();
    expect(() => setQuoteEnabled(repo, 999, false)).toThrow();
  });

  it("clears the disabled flag through an edit", () => {
    const repo = new FakeDailyQuoteRepository();
    const created = createQuote(repo, { quote: "Fix me", author: "A", category: "Humor" });
    setQuoteEnabled(repo, created.id, false);

    const updated = updateQuote(repo, created.id, {
      quote: "Fixed",
      author: "A",
      category: "Humor",
      isEnabled: true,
    });
    expect(updated.isEnabled).toBe(true);
  });

  it("re-enables a quote when an update omits the flag", () => {
    // Documents the default rather than endorsing it as a way to toggle status:
    // callers that mean to change only the flag use setQuoteEnabled.
    const repo = new FakeDailyQuoteRepository();
    const created = createQuote(repo, { quote: "Omitted", author: "A", category: "Life" });
    setQuoteEnabled(repo, created.id, false);

    const updated = updateQuote(repo, created.id, {
      quote: "Omitted",
      author: "A",
      category: "Life",
    });
    expect(updated.isEnabled).toBe(true);
  });

  it("updates and deletes a quote", () => {
    const repo = new FakeDailyQuoteRepository();
    const created = createQuote(repo, { quote: "Original", author: "A", category: "Humor" });
    const updated = updateQuote(repo, created.id, {
      quote: "Edited",
      author: "B",
      category: "Love",
    });
    expect(updated.quote).toBe("Edited");
    expect(updated.category).toBe("Love");

    deleteQuote(repo, created.id);
    expect(listQuotes(repo)).toHaveLength(0);
  });
});
