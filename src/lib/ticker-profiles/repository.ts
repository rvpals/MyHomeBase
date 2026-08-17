import type Database from "better-sqlite3";
import type { TickerProfileRepository } from "./ports";
import type { FetchedProfile, TickerProfileRecord } from "./types";

interface ProfileRow {
  ticker: string;
  sector: string;
  industry: string;
  manual_sector: string;
  source: string;
  fetched_at: string;
}

function toRecord(row: ProfileRow): TickerProfileRecord {
  return {
    ticker: row.ticker,
    sector: row.sector,
    industry: row.industry,
    manualSector: row.manual_sector,
    source: row.source,
    fetchedAt: row.fetched_at,
  };
}

// The real repository. Rows are keyed by ticker, and a blank sector is a
// recorded "the provider reported none" rather than an absent row.
export class SqliteTickerProfileRepository implements TickerProfileRepository {
  constructor(private db: Database.Database) {}

  get(ticker: string): TickerProfileRecord | undefined {
    const row = this.db.prepare("SELECT * FROM stk_ticker_profiles WHERE ticker = ?").get(ticker) as
      | ProfileRow
      | undefined;
    return row ? toRecord(row) : undefined;
  }

  list(): TickerProfileRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM stk_ticker_profiles ORDER BY ticker")
      .all() as ProfileRow[];
    return rows.map(toRecord);
  }

  save(ticker: string, profile: FetchedProfile, source: string): void {
    // manual_sector is absent from the UPDATE on purpose: a refresh brings new
    // provider data, and must not throw away a sector the user set by hand.
    this.db
      .prepare(
        `INSERT INTO stk_ticker_profiles (ticker, sector, industry, source, fetched_at)
         VALUES (@ticker, @sector, @industry, @source, datetime('now'))
         ON CONFLICT(ticker) DO UPDATE SET
           sector = excluded.sector,
           industry = excluded.industry,
           source = excluded.source,
           fetched_at = excluded.fetched_at`,
      )
      .run({ ticker, sector: profile.sector, industry: profile.industry, source });
  }
}
