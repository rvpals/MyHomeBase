import type {
  CreateInvestmentAccountInput,
  CreatePerformanceRecordInput,
  UpdateInvestmentAccountInput,
  UpdatePerformanceRecordInput,
} from "./schema";
import type { InvestmentAccount, PerformanceRecord } from "./types";

export interface InvestmentAccountRepository {
  listAccounts(): InvestmentAccount[];
  getAccountById(id: number): InvestmentAccount | undefined;
  createAccount(input: CreateInvestmentAccountInput): InvestmentAccount;
  updateAccount(id: number, input: UpdateInvestmentAccountInput): InvestmentAccount;
  deleteAccount(id: number): void;

  listPerformanceRecords(accountId?: number): PerformanceRecord[];
  getPerformanceRecordById(id: number): PerformanceRecord | undefined;
  /**
   * Upserts by (accountId, recordDate) and syncs the parent account's
   * lastValueCents/lastUpdatedAt in the same transaction — see migration
   * 0015's denormalization note.
   */
  addPerformanceRecord(input: CreatePerformanceRecordInput): PerformanceRecord;
  updatePerformanceRecord(id: number, input: UpdatePerformanceRecordInput): PerformanceRecord;
  deletePerformanceRecord(id: number): void;
  /**
   * Inserts unless a record already exists for (accountId, recordDate) —
   * used by CSV import so re-importing the same export never overwrites a
   * value that was already recorded (unlike addPerformanceRecord's upsert).
   */
  addPerformanceRecordIfNotExists(
    input: CreatePerformanceRecordInput,
  ): { inserted: boolean; record?: PerformanceRecord };
}
