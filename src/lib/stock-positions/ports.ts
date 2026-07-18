import type {
  CreateTransactionInput,
  UpdateTransactionInput,
  UpsertPositionInput,
} from "./schema";
import type { StockPosition, StockTransaction } from "./types";

export interface StockPositionRepository {
  listPositions(): StockPosition[];
  getPositionByTicker(ticker: string): StockPosition | undefined;
  upsertPosition(input: UpsertPositionInput, valueCents: number): StockPosition;
  deletePosition(ticker: string): void;

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
