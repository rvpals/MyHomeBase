import type Database from "better-sqlite3";
import type { StockPositionRepository } from "./ports";
import { stockPositionSchema, stockTransactionSchema } from "./schema";
import type { CreateTransactionInput, UpdateTransactionInput, UpsertPositionInput } from "./schema";
import type { PositionKey, StockPosition, StockTransaction } from "./types";

interface StockPositionRow {
  account_id: number;
  ticker: string;
  name: string;
  type: string;
  current_price_cents: number;
  quantity: number;
  day_gain_loss_cents: number;
  value_cents: number;
  day_high_cents: number;
  day_low_cents: number;
  dividend_rate_cents: number;
  cost_cents: number;
  unit_cost_cents: number;
  unrealized_gain_loss_cents: number;
  unrealized_gain_loss_pct: number;
  cusip: string;
  isin: string;
  asset_class: string;
  asset_strategy: string;
  est_annual_income_cents: number;
  income_earned_cents: number;
  created_at: string;
  updated_at: string;
}

interface StockTransactionRow {
  id: number;
  transaction_at: string;
  action: string;
  ticker: string;
  number_of_shares: number;
  price_per_share_cents: number;
  total_amount_cents: number;
  note: string;
  created_at: string;
  updated_at: string;
}

function positionToDomain(row: StockPositionRow): StockPosition {
  return stockPositionSchema.parse({
    accountId: row.account_id,
    ticker: row.ticker,
    name: row.name,
    type: row.type,
    currentPriceCents: row.current_price_cents,
    quantity: row.quantity,
    dayGainLossCents: row.day_gain_loss_cents,
    valueCents: row.value_cents,
    dayHighCents: row.day_high_cents,
    dayLowCents: row.day_low_cents,
    dividendRateCents: row.dividend_rate_cents,
    costCents: row.cost_cents,
    unitCostCents: row.unit_cost_cents,
    unrealizedGainLossCents: row.unrealized_gain_loss_cents,
    unrealizedGainLossPct: row.unrealized_gain_loss_pct,
    cusip: row.cusip,
    isin: row.isin,
    assetClass: row.asset_class,
    assetStrategy: row.asset_strategy,
    estAnnualIncomeCents: row.est_annual_income_cents,
    incomeEarnedCents: row.income_earned_cents,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function transactionToDomain(row: StockTransactionRow): StockTransaction {
  return stockTransactionSchema.parse({
    id: row.id,
    transactionAt: row.transaction_at,
    action: row.action,
    ticker: row.ticker,
    numberOfShares: row.number_of_shares,
    pricePerShareCents: row.price_per_share_cents,
    totalAmountCents: row.total_amount_cents,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

// The real repository. Swap the database without touching any use-case.
export class SqliteStockPositionRepository implements StockPositionRepository {
  constructor(private db: Database.Database) {}

  listPositions(accountId?: number): StockPosition[] {
    const rows = (
      accountId === undefined
        ? this.db.prepare("SELECT * FROM stk_stock_positions ORDER BY ticker ASC").all()
        : this.db
            .prepare("SELECT * FROM stk_stock_positions WHERE account_id = ? ORDER BY ticker ASC")
            .all(accountId)
    ) as StockPositionRow[];
    return rows.map(positionToDomain);
  }

  getPosition(key: PositionKey): StockPosition | undefined {
    const row = this.db
      .prepare("SELECT * FROM stk_stock_positions WHERE account_id = ? AND ticker = ?")
      .get(key.accountId, key.ticker) as StockPositionRow | undefined;
    return row ? positionToDomain(row) : undefined;
  }

  // Rides idx_stock_positions_ticker — account_id leads the primary key, so a
  // ticker-only lookup has no usable key prefix without that index.
  listPositionsByTicker(ticker: string): StockPosition[] {
    const rows = this.db
      .prepare("SELECT * FROM stk_stock_positions WHERE ticker = ? ORDER BY account_id ASC")
      .all(ticker) as StockPositionRow[];
    return rows.map(positionToDomain);
  }

  // valueCents is computed by the use-case (currentPriceCents * quantity) and
  // passed in — the repository never derives business values itself.
  upsertPosition(input: UpsertPositionInput, valueCents: number): StockPosition {
    const row = this.db
      .prepare(
        `INSERT INTO stk_stock_positions
           (account_id, ticker, name, type, current_price_cents, quantity, day_gain_loss_cents,
            value_cents, day_high_cents, day_low_cents, dividend_rate_cents,
            cost_cents, unit_cost_cents, unrealized_gain_loss_cents, unrealized_gain_loss_pct,
            cusip, isin, asset_class, asset_strategy,
            est_annual_income_cents, income_earned_cents)
         VALUES
           (@accountId, @ticker, @name, @type, @currentPriceCents, @quantity, @dayGainLossCents,
            @valueCents, @dayHighCents, @dayLowCents, @dividendRateCents,
            @costCents, @unitCostCents, @unrealizedGainLossCents, @unrealizedGainLossPct,
            @cusip, @isin, @assetClass, @assetStrategy,
            @estAnnualIncomeCents, @incomeEarnedCents)
         ON CONFLICT (account_id, ticker) DO UPDATE SET
           name = excluded.name,
           type = excluded.type,
           current_price_cents = excluded.current_price_cents,
           quantity = excluded.quantity,
           day_gain_loss_cents = excluded.day_gain_loss_cents,
           value_cents = excluded.value_cents,
           day_high_cents = excluded.day_high_cents,
           day_low_cents = excluded.day_low_cents,
           dividend_rate_cents = excluded.dividend_rate_cents,
           cost_cents = excluded.cost_cents,
           unit_cost_cents = excluded.unit_cost_cents,
           unrealized_gain_loss_cents = excluded.unrealized_gain_loss_cents,
           unrealized_gain_loss_pct = excluded.unrealized_gain_loss_pct,
           cusip = excluded.cusip,
           isin = excluded.isin,
           asset_class = excluded.asset_class,
           asset_strategy = excluded.asset_strategy,
           est_annual_income_cents = excluded.est_annual_income_cents,
           income_earned_cents = excluded.income_earned_cents
         RETURNING *`,
      )
      .get({ ...input, valueCents }) as StockPositionRow;
    return positionToDomain(row);
  }

  deletePosition(key: PositionKey): void {
    this.db
      .prepare("DELETE FROM stk_stock_positions WHERE account_id = ? AND ticker = ?")
      .run(key.accountId, key.ticker);
  }

  listTransactions(ticker?: string): StockTransaction[] {
    const rows = (
      ticker === undefined
        ? this.db.prepare("SELECT * FROM stk_stock_transactions ORDER BY transaction_at ASC").all()
        : this.db
            .prepare("SELECT * FROM stk_stock_transactions WHERE ticker = ? ORDER BY transaction_at ASC")
            .all(ticker)
    ) as StockTransactionRow[];
    return rows.map(transactionToDomain);
  }

  getTransactionById(id: number): StockTransaction | undefined {
    const row = this.db.prepare("SELECT * FROM stk_stock_transactions WHERE id = ?").get(id) as
      | StockTransactionRow
      | undefined;
    return row ? transactionToDomain(row) : undefined;
  }

  createTransaction(input: CreateTransactionInput, totalAmountCents: number): StockTransaction {
    const result = this.db
      .prepare(
        `INSERT INTO stk_stock_transactions
           (transaction_at, action, ticker, number_of_shares, price_per_share_cents, total_amount_cents, note)
         VALUES
           (@transactionAt, @action, @ticker, @numberOfShares, @pricePerShareCents, @totalAmountCents, @note)`,
      )
      .run({ ...input, totalAmountCents });

    const created = this.getTransactionById(Number(result.lastInsertRowid));
    if (!created) throw new Error("Failed to read back newly created transaction.");
    return created;
  }

  updateTransaction(
    id: number,
    input: UpdateTransactionInput,
    totalAmountCents: number,
  ): StockTransaction {
    this.db
      .prepare(
        `UPDATE stk_stock_transactions
         SET transaction_at = @transactionAt, action = @action, ticker = @ticker,
             number_of_shares = @numberOfShares, price_per_share_cents = @pricePerShareCents,
             total_amount_cents = @totalAmountCents, note = @note
         WHERE id = @id`,
      )
      .run({ ...input, totalAmountCents, id });

    const updated = this.getTransactionById(id);
    if (!updated) throw new Error(`Failed to read back updated transaction ${id}.`);
    return updated;
  }

  deleteTransaction(id: number): void {
    this.db.prepare("DELETE FROM stk_stock_transactions WHERE id = ?").run(id);
  }

  insertTransactionIfNotExists(
    input: CreateTransactionInput,
    totalAmountCents: number,
  ): { inserted: boolean; transaction?: StockTransaction } {
    const row = this.db
      .prepare(
        `INSERT OR IGNORE INTO stk_stock_transactions
           (transaction_at, action, ticker, number_of_shares, price_per_share_cents, total_amount_cents, note)
         VALUES
           (@transactionAt, @action, @ticker, @numberOfShares, @pricePerShareCents, @totalAmountCents, @note)
         RETURNING *`,
      )
      .get({ ...input, totalAmountCents }) as StockTransactionRow | undefined;

    return row ? { inserted: true, transaction: transactionToDomain(row) } : { inserted: false };
  }
}
