import type Database from "better-sqlite3";
import { symbolDateKey } from "./match-key";
import type { TBillRepository } from "./ports";
import { tbillPurchaseSchema } from "./schema";
import type { CreateTBillPurchaseInput, UpdateTBillPurchaseInput } from "./schema";
import type { TBillPurchase } from "./types";

interface TBillPurchaseRow {
  id: number;
  symbol: string;
  description: string;
  date_purchased: string;
  date_payout: string;
  shares_purchased: number;
  purchase_price: number;
  amount_spent_cents: number;
  payout_amount_cents: number;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  "id, symbol, description, date_purchased, date_payout, shares_purchased, " +
  "purchase_price, amount_spent_cents, payout_amount_cents, created_at, updated_at";

function toDomain(row: TBillPurchaseRow): TBillPurchase {
  return tbillPurchaseSchema.parse({
    id: row.id,
    symbol: row.symbol,
    description: row.description,
    datePurchased: row.date_purchased,
    datePayout: row.date_payout,
    sharesPurchased: row.shares_purchased,
    purchasePrice: row.purchase_price,
    amountSpentCents: row.amount_spent_cents,
    payoutAmountCents: row.payout_amount_cents,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

// The real repository. Swap the database without touching any use-case.
export class SqliteTBillRepository implements TBillRepository {
  constructor(private db: Database.Database) {}

  listPurchases(): TBillPurchase[] {
    const rows = this.db
      .prepare(
        `SELECT ${COLUMNS} FROM inv_tbill_purchases ORDER BY date_purchased DESC, id DESC`,
      )
      .all() as TBillPurchaseRow[];
    return rows.map(toDomain);
  }

  getPurchaseById(id: number): TBillPurchase | undefined {
    const row = this.db
      .prepare(`SELECT ${COLUMNS} FROM inv_tbill_purchases WHERE id = ?`)
      .get(id) as TBillPurchaseRow | undefined;
    return row ? toDomain(row) : undefined;
  }

  createPurchase(input: CreateTBillPurchaseInput): TBillPurchase {
    const result = this.db
      .prepare(
        `INSERT INTO inv_tbill_purchases
           (symbol, description, date_purchased, date_payout, shares_purchased,
            purchase_price, amount_spent_cents, payout_amount_cents)
         VALUES
           (@symbol, @description, @datePurchased, @datePayout, @sharesPurchased,
            @purchasePrice, @amountSpentCents, @payoutAmountCents)`,
      )
      .run(input);

    const created = this.getPurchaseById(Number(result.lastInsertRowid));
    if (!created) throw new Error("Failed to read back the newly created T-Bill purchase.");
    return created;
  }

  updatePurchase(id: number, input: UpdateTBillPurchaseInput): TBillPurchase {
    this.db
      .prepare(
        `UPDATE inv_tbill_purchases
         SET symbol = @symbol,
             description = @description,
             date_purchased = @datePurchased,
             date_payout = @datePayout,
             shares_purchased = @sharesPurchased,
             purchase_price = @purchasePrice,
             amount_spent_cents = @amountSpentCents,
             payout_amount_cents = @payoutAmountCents,
             updated_at = datetime('now')
         WHERE id = @id`,
      )
      .run({ ...input, id });

    const updated = this.getPurchaseById(id);
    if (!updated) throw new Error(`No T-Bill purchase with id ${id}.`);
    return updated;
  }

  deletePurchase(id: number): void {
    this.db.prepare("DELETE FROM inv_tbill_purchases WHERE id = ?").run(id);
  }

  countsBySymbolAndDate(): Map<string, number> {
    const rows = this.db
      .prepare(
        `SELECT symbol, date_purchased, COUNT(*) AS row_count
           FROM inv_tbill_purchases
          GROUP BY LOWER(TRIM(symbol)), date_purchased`,
      )
      .all() as { symbol: string; date_purchased: string; row_count: number }[];

    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(symbolDateKey(row.symbol, row.date_purchased), row.row_count);
    }
    return counts;
  }
}
