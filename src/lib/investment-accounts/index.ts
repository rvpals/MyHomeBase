export type { AccountIcon, InvestmentAccount, PerformanceRecord } from "./types";
export {
  MAX_ACCOUNT_ICON_BYTES,
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
  setAccountIcon,
  clearAccountIcon,
  getAccountIcon,
  listPerformanceRecords,
  addPerformanceRecord,
  updatePerformanceRecord,
  deletePerformanceRecord,
  extractCsvAccountNames,
  importPerformanceFromCsv,
  PERFORMANCE_IMPORT_FIELDS,
} from "./investment-accounts";
