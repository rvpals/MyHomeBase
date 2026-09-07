import type Database from "better-sqlite3";
import type { TaxLotRepository } from "./ports";
import type { CreateTaxLotInput, UpdateTaxLotInput } from "./schema";
import type { TaxLot } from "./types";

interface TaxLotRow {
  id: number;
  ticker: string;
  buy_date: string;
  shares: number;
  price_per_share_cents: number;
  is_split_adjusted: number;
  brokerage_firm: string;
  note: string;
  created_at: string;
  updated_at: string;
}

/** SQLite has no boolean type, so the 0/1 column becomes one at the boundary. */
function toTaxLot(row: TaxLotRow): TaxLot {
  return {
    id: row.id,
    ticker: row.ticker,
    buyDate: row.buy_date,
    shares: row.shares,
    pricePerShareCents: row.price_per_share_cents,
    isSplitAdjusted: row.is_split_adjusted === 1,
    brokerageFirm: row.brokerage_firm,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_LOTS = `SELECT id, ticker, buy_date, shares, price_per_share_cents,
                            is_split_adjusted, brokerage_firm, note, created_at, updated_at
                     FROM stk_tax_lots`;

/**
 * The only file in the Tax Lots module that knows SQL.
 *
 * Reads come back oldest first with `id` as the tie-break, because `buy_date` is a
 * date: several lots of one ticker bought on the same day are ordinary and would
 * otherwise come back in an order SQLite does not promise, making the analyzer's
 * row order shift between renders for no visible reason.
 */
export class SqliteTaxLotRepository implements TaxLotRepository {
  constructor(private readonly db: Database.Database) {}

  listLots(ticker?: string): TaxLot[] {
    const rows = ticker
      ? this.db
          .prepare(`${SELECT_LOTS} WHERE ticker = ? ORDER BY buy_date ASC, id ASC`)
          .all(ticker)
      : this.db.prepare(`${SELECT_LOTS} ORDER BY ticker ASC, buy_date ASC, id ASC`).all();

    return (rows as TaxLotRow[]).map(toTaxLot);
  }

  getLotById(id: number): TaxLot | undefined {
    const row = this.db.prepare(`${SELECT_LOTS} WHERE id = ?`).get(id) as TaxLotRow | undefined;
    return row ? toTaxLot(row) : undefined;
  }

  listTickers(): string[] {
    const rows = this.db
      .prepare(`SELECT DISTINCT ticker FROM stk_tax_lots ORDER BY ticker ASC`)
      .all();
    return (rows as { ticker: string }[]).map((row) => row.ticker);
  }

  createLot(input: CreateTaxLotInput): TaxLot {
    const result = this.db
      .prepare(
        `INSERT INTO stk_tax_lots
           (ticker, buy_date, shares, price_per_share_cents, is_split_adjusted,
            brokerage_firm, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      )
      .run(
        input.ticker,
        input.buyDate,
        input.shares,
        input.pricePerShareCents,
        input.isSplitAdjusted ? 1 : 0,
        input.brokerageFirm,
        input.note,
      );

    const created = this.getLotById(Number(result.lastInsertRowid));
    // Inserted on this same connection, so it cannot miss — checked rather than
    // asserted away so a future change to the SELECT fails loudly instead of
    // becoming a confusing non-null crash.
    if (!created) throw new Error("Failed to read back the tax lot just created.");
    return created;
  }

  updateLot(id: number, input: UpdateTaxLotInput): TaxLot {
    this.db
      .prepare(
        `UPDATE stk_tax_lots
         SET ticker = ?, buy_date = ?, shares = ?, price_per_share_cents = ?,
             is_split_adjusted = ?, brokerage_firm = ?, note = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(
        input.ticker,
        input.buyDate,
        input.shares,
        input.pricePerShareCents,
        input.isSplitAdjusted ? 1 : 0,
        input.brokerageFirm,
        input.note,
        id,
      );

    const updated = this.getLotById(id);
    if (!updated) throw new Error(`No tax lot with id ${id}.`);
    return updated;
  }

  deleteLot(id: number): void {
    this.db.prepare(`DELETE FROM stk_tax_lots WHERE id = ?`).run(id);
  }
}
