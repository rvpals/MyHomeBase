export type { InvestmentAccount, PerformanceRecord } from "./types";
export {
  investmentAccountSchema,
  createInvestmentAccountSchema,
  updateInvestmentAccountSchema,
  performanceRecordSchema,
  createPerformanceRecordSchema,
  updatePerformanceRecordSchema,
  type CreateInvestmentAccountInput,
  type UpdateInvestmentAccountInput,
  type CreatePerformanceRecordInput,
  type UpdatePerformanceRecordInput,
} from "./schema";
export type { InvestmentAccountRepository } from "./ports";
export {
  listAccounts,
  getAccountById,
  createAccount,
  updateAccount,
  deleteAccount,
  listPerformanceRecords,
  addPerformanceRecord,
  updatePerformanceRecord,
  deletePerformanceRecord,
  extractCsvAccountNames,
  importPerformanceFromCsv,
} from "./investment-accounts";
