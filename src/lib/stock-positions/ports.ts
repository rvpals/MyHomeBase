import type {
  CreateTransactionInput,
  UpdateTransactionInput,
  UpsertPositionInput,
} from "./schema";
import type { PositionKey, StockPosition, StockTransaction } from "./types";

export interface StockPositionRepository {
  /** Every position, or only one account's when `accountId` is given. */
  listPositions(accountId?: number): StockPosition[];
  /** One position. A ticker can be held in more than one account, so both parts are required. */
  getPosition(key: PositionKey): StockPosition | undefined;
  /**
   * Every account holding this ticker. Used where a symbol is the subject rather
   * than a holding — refreshing a quote, or scanning for next-day signals.
   */
  listPositionsByTicker(ticker: string): StockPosition[];
  upsertPosition(input: UpsertPositionInput, valueCents: number): StockPosition;
  deletePosition(key: PositionKey): void;

  listTransactions(ticker?: string): StockTransaction[];
  getTransactionById(id: number): StockTransaction | undefined;
  createTransaction(input: CreateTransactionInput, totalAmountCents: number): StockTransaction;
  updateTransaction(
    id: number,
    input: UpdateTransactionInput,
    totalAmountCents: number,
  ): StockTransaction;
  deleteTransaction(id: number): void;
  /**
   * Inserts unless a row already matches the (transaction_at, action, ticker,
   * total_amount_cents) unique index — used by CSV import so re-importing the
   * same export is a safe no-op instead of creating duplicates.
   */
  insertTransactionIfNotExists(
    input: CreateTransactionInput,
    totalAmountCents: number,
  ): { inserted: boolean; transaction?: StockTransaction };
}
