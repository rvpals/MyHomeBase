import type Database from "better-sqlite3";
import type { TickerFavoriteRepository } from "./ports";
import type { TickerFavorite } from "./types";

interface FavoriteRow {
  ticker: string;
  created_at: string;
}

function toFavorite(row: FavoriteRow): TickerFavorite {
  return { ticker: row.ticker, createdAt: row.created_at };
}

// Keyed by ticker, so both writes are single-statement and idempotent — see
// migrations/0058_create_ticker_favorites.md for why there's no surrogate id.
export class SqliteTickerFavoriteRepository implements TickerFavoriteRepository {
  constructor(private db: Database.Database) {}

  list(): TickerFavorite[] {
    // `ticker` breaks ties: two symbols starred in the same second would
    // otherwise come back in an arbitrary order that could change between reads.
    const rows = this.db
      .prepare("SELECT * FROM stk_ticker_favorites ORDER BY created_at DESC, ticker")
      .all() as FavoriteRow[];
    return rows.map(toFavorite);
  }

  isFavorite(ticker: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM stk_ticker_favorites WHERE ticker = ?")
      .get(ticker) as { 1: number } | undefined;
    return row !== undefined;
  }

  add(ticker: string): void {
    // DO NOTHING rather than an upsert: re-starring must not move a favorite to
    // the top of the list, because the click that does it is the click that
    // *unstars* — an accidental double-press should leave the list untouched.
    this.db
      .prepare("INSERT INTO stk_ticker_favorites (ticker) VALUES (?) ON CONFLICT(ticker) DO NOTHING")
      .run(ticker);
  }

  remove(ticker: string): void {
    this.db.prepare("DELETE FROM stk_ticker_favorites WHERE ticker = ?").run(ticker);
  }
}
