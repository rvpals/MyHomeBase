import type Database from "better-sqlite3";
import type { DailyQuoteRepository } from "./ports";
import { dailyQuoteSchema } from "./schema";
import type { QuoteWriteData } from "./schema";
import type { DailyQuote } from "./types";

interface DailyQuoteRow {
  id: number;
  quote: string;
  author: string;
  category: string;
  source: string;
  created_at: string;
  updated_at: string;
}

function toDomain(row: DailyQuoteRow): DailyQuote {
  return dailyQuoteSchema.parse({
    id: row.id,
    quote: row.quote,
    author: row.author,
    category: row.category,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

// The real repository. Swap the database without touching any use-case.
export class SqliteDailyQuoteRepository implements DailyQuoteRepository {
  constructor(private db: Database.Database) {}

  listQuotes(): DailyQuote[] {
    const rows = this.db
      .prepare("SELECT * FROM sys_daily_quotes ORDER BY created_at DESC, id DESC")
      .all() as DailyQuoteRow[];
    return rows.map(toDomain);
  }

  getQuoteById(id: number): DailyQuote | undefined {
    const row = this.db.prepare("SELECT * FROM sys_daily_quotes WHERE id = ?").get(id) as
      | DailyQuoteRow
      | undefined;
    return row ? toDomain(row) : undefined;
  }

  getRandomQuote(): DailyQuote | undefined {
    const row = this.db
      .prepare("SELECT * FROM sys_daily_quotes ORDER BY RANDOM() LIMIT 1")
      .get() as DailyQuoteRow | undefined;
    return row ? toDomain(row) : undefined;
  }

  createQuote(input: QuoteWriteData): DailyQuote {
    const result = this.db
      .prepare(
        `INSERT INTO sys_daily_quotes (quote, author, category, source)
         VALUES (@quote, @author, @category, @source)`,
      )
      .run(input);

    const created = this.getQuoteById(Number(result.lastInsertRowid));
    if (!created) throw new Error("Failed to read back newly created quote.");
    return created;
  }

  updateQuote(id: number, input: QuoteWriteData): DailyQuote {
    this.db
      .prepare(
        `UPDATE sys_daily_quotes
         SET quote = @quote, author = @author, category = @category, source = @source
         WHERE id = @id`,
      )
      .run({ ...input, id });

    const updated = this.getQuoteById(id);
    if (!updated) throw new Error(`Failed to read back updated quote ${id}.`);
    return updated;
  }

  deleteQuote(id: number): void {
    this.db.prepare("DELETE FROM sys_daily_quotes WHERE id = ?").run(id);
  }
}
