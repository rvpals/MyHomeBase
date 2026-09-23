import type Database from "better-sqlite3";
import type { IndexLogoRepository } from "./ports";
import type { IndexLogoImage, IndexLogoRecord } from "./types";

interface IndexLogoRow {
  symbol: string;
  image: Buffer | null;
  image_mime_type: string | null;
  source: string;
  fetched_at: string;
}

// The real repository (migrations/0099). Rows are keyed by the provider symbol,
// and a NULL image is a recorded "nothing found" rather than an absent row.
export class SqliteIndexLogoRepository implements IndexLogoRepository {
  constructor(private db: Database.Database) {}

  get(symbol: string): IndexLogoRecord | undefined {
    const row = this.db.prepare("SELECT * FROM inv_index_logos WHERE symbol = ?").get(symbol) as
      | IndexLogoRow
      | undefined;
    if (!row) return undefined;

    const image: IndexLogoImage | undefined =
      row.image && row.image_mime_type
        ? { data: row.image, mimeType: row.image_mime_type }
        : undefined;

    return { symbol: row.symbol, image, source: row.source, fetchedAt: row.fetched_at };
  }

  save(symbol: string, image: IndexLogoImage, source: string): void {
    this.db
      .prepare(
        `INSERT INTO inv_index_logos (symbol, image, image_mime_type, source, fetched_at)
         VALUES (@symbol, @image, @mimeType, @source, datetime('now'))
         ON CONFLICT(symbol) DO UPDATE SET
           image = excluded.image,
           image_mime_type = excluded.image_mime_type,
           source = excluded.source,
           fetched_at = excluded.fetched_at`,
      )
      .run({ symbol, image: image.data, mimeType: image.mimeType, source });
  }

  saveMissing(symbol: string, source: string): void {
    this.db
      .prepare(
        `INSERT INTO inv_index_logos (symbol, image, image_mime_type, source, fetched_at)
         VALUES (@symbol, NULL, NULL, @source, datetime('now'))
         ON CONFLICT(symbol) DO UPDATE SET
           image = NULL,
           image_mime_type = NULL,
           source = excluded.source,
           fetched_at = excluded.fetched_at`,
      )
      .run({ symbol, source });
  }
}
