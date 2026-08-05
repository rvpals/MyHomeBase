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
  /** True when a transaction already carries this broker reference. Blank is never found. */
  hasTransactionWithExternalId(externalId: string): boolean;
  /**
   * How many stored transactions match this trade exactly, ignoring note and id.
   *
   * The importer needs a **count**, not a yes/no: `transaction_at` is a date, so
   * three identical intraday lots are three legitimate rows that look the same. Only
   * by comparing how many the file holds against how many are stored can it insert
   * the shortfall and stay idempotent on re-import.
   */
  countMatchingTransactions(key: TransactionMatchKey): number;
}

/** The fields that make two transactions the same trade, absent a broker reference. */
export interface TransactionMatchKey {
  transactionAt: string;
  action: string;
  ticker: string;
  numberOfShares: number;
  pricePerShareCents: number;
  brokerageFirm: string;
}
