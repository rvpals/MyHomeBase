import type Database from "better-sqlite3";
import type { TickerLogoRepository } from "./ports";
import type { TickerLogoImage, TickerLogoRecord } from "./types";

interface LogoRow {
  ticker: string;
  image: Buffer | null;
  image_mime_type: string | null;
  source: string;
  fetched_at: string;
}

// The real repository. Rows are keyed by ticker, and a NULL image is a recorded
// "nothing found" rather than an absent row.
export class SqliteTickerLogoRepository implements TickerLogoRepository {
  constructor(private db: Database.Database) {}

  get(ticker: string): TickerLogoRecord | undefined {
    const row = this.db.prepare("SELECT * FROM stk_ticker_logos WHERE ticker = ?").get(ticker) as
      | LogoRow
      | undefined;
    if (!row) return undefined;

    const image: TickerLogoImage | undefined =
      row.image && row.image_mime_type
        ? { data: row.image, mimeType: row.image_mime_type }
        : undefined;

    return { ticker: row.ticker, image, source: row.source, fetchedAt: row.fetched_at };
  }

  save(ticker: string, image: TickerLogoImage, source: string): void {
    this.db
      .prepare(
        `INSERT INTO stk_ticker_logos (ticker, image, image_mime_type, source, fetched_at)
         VALUES (@ticker, @image, @mimeType, @source, datetime('now'))
         ON CONFLICT(ticker) DO UPDATE SET
           image = excluded.image,
           image_mime_type = excluded.image_mime_type,
           source = excluded.source,
           fetched_at = excluded.fetched_at`,
      )
      .run({ ticker, image: image.data, mimeType: image.mimeType, source });
  }

  saveMissing(ticker: string, source: string): void {
    this.db
      .prepare(
        `INSERT INTO stk_ticker_logos (ticker, image, image_mime_type, source, fetched_at)
         VALUES (@ticker, NULL, NULL, @source, datetime('now'))
         ON CONFLICT(ticker) DO UPDATE SET
           image = NULL,
           image_mime_type = NULL,
           source = excluded.source,
           fetched_at = excluded.fetched_at`,
      )
      .run({ ticker, source });
  }
}
