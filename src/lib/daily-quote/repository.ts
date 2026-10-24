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
  is_enabled: number;
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
    isEnabled: row.is_enabled === 1,
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

  // The widget's read, and the only filtered one. `listQuotes` above stays
  // unfiltered on purpose: the admin grid shows the whole table, disabled rows
  // included, so a quote taken out of rotation is still where the admin left it.
  getRandomQuote(): DailyQuote | undefined {
    const row = this.db
      .prepare("SELECT * FROM sys_daily_quotes WHERE is_enabled = 1 ORDER BY RANDOM() LIMIT 1")
      .get() as DailyQuoteRow | undefined;
    return row ? toDomain(row) : undefined;
  }

  createQuote(input: QuoteWriteData): DailyQuote {
    const result = this.db
      .prepare(
        `INSERT INTO sys_daily_quotes (quote, author, category, source, is_enabled)
         VALUES (@quote, @author, @category, @source, @isEnabled)`,
      )
      .run({ ...input, isEnabled: input.isEnabled ? 1 : 0 });

    const created = this.getQuoteById(Number(result.lastInsertRowid));
    if (!created) throw new Error("Failed to read back newly created quote.");
    return created;
  }

  updateQuote(id: number, input: QuoteWriteData): DailyQuote {
    this.db
      .prepare(
        `UPDATE sys_daily_quotes
         SET quote = @quote, author = @author, category = @category, source = @source,
             is_enabled = @isEnabled
         WHERE id = @id`,
      )
      .run({ ...input, isEnabled: input.isEnabled ? 1 : 0, id });

    const updated = this.getQuoteById(id);
    if (!updated) throw new Error(`Failed to read back updated quote ${id}.`);
    return updated;
  }

  setQuoteEnabled(id: number, isEnabled: boolean): DailyQuote {
    this.db
      .prepare("UPDATE sys_daily_quotes SET is_enabled = ? WHERE id = ?")
      .run(isEnabled ? 1 : 0, id);

    const updated = this.getQuoteById(id);
    if (!updated) throw new Error(`Failed to read back quote ${id}.`);
    return updated;
  }

  deleteQuote(id: number): void {
    this.db.prepare("DELETE FROM sys_daily_quotes WHERE id = ?").run(id);
  }
}
