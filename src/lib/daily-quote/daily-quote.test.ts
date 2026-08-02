import { describe, expect, it } from "vitest";
import { createQuote, deleteQuote, getRandomQuote, listQuotes, updateQuote } from "./daily-quote";
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
  getRandomQuote(): DailyQuote | undefined {
    if (this.rows.length === 0) return undefined;
    return this.rows[Math.floor(Math.random() * this.rows.length)];
  }
  createQuote(input: QuoteWriteData): DailyQuote {
    this.createCalls.push(input);
    const row: DailyQuote = {
      id: this.nextId++,
      quote: input.quote,
      author: input.author,
      category: input.category,
      source: input.source,
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
