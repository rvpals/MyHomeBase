import type {
  AccountWriteData,
  CategoryRuleWriteData,
  CategoryWriteData,
  TransactionWriteData,
} from "./schema";
import type {
  CardImage,
  CategoryRule,
  CategoryTotal,
  CreditCardAccount,
  ExpenseCategory,
  ExpenseTransaction,
} from "./types";

/** Narrows the transaction list. Omitted fields mean "no constraint". */
export interface TransactionFilter {
  accountId?: number;
  categoryName?: string;
  status?: string;
  /** Inclusive ISO date bounds on transaction_date. */
  fromDate?: string;
  toDate?: string;
}

export interface ExpenseRepository {
  // Credit-card accounts
  listAccounts(): CreditCardAccount[];
  getAccountById(id: number): CreditCardAccount | undefined;
  createAccount(input: AccountWriteData): CreditCardAccount;
  updateAccount(id: number, input: AccountWriteData): CreditCardAccount;
  /** Refused by the use-case while transactions still reference the account. */
  deleteAccount(id: number): void;
  countTransactionsForAccount(id: number): number;
  /** Reads the image bytes. Only the image-serving route calls this. */
  getAccountImage(id: number): CardImage | undefined;
  /** Passing undefined clears the image. */
  setAccountImage(id: number, image: CardImage | undefined): void;

  // Categories
  listCategories(): ExpenseCategory[];
  getCategoryByName(name: string): ExpenseCategory | undefined;
  upsertCategory(input: CategoryWriteData): ExpenseCategory;
  /** Deletes the category and clears it from any transaction using it. */
  deleteCategory(name: string): void;
  /** Insert-if-absent, so a name used on a transaction always exists. */
  registerCategoriesIfMissing(names: string[]): void;

  // Transactions
  listTransactions(filter?: TransactionFilter): ExpenseTransaction[];
  getTransactionById(id: number): ExpenseTransaction | undefined;
  createTransaction(input: TransactionWriteData, createdByUserId: number): ExpenseTransaction;
  updateTransaction(id: number, input: TransactionWriteData): ExpenseTransaction;
  deleteTransaction(id: number): void;
  /** True when an identical row already exists — used to skip re-imports. */
  transactionExists(input: {
    transactionAccountId: number;
    transactionDate: string;
    transactionDescription: string;
    amountCents: number;
  }): boolean;
  /** Applies a rule's outcome to one transaction without touching other fields. */
  setTransactionCategoryAndStatus(id: number, categoryName: string, status: string): void;

  // Rules
  listRules(): CategoryRule[];
  getRuleById(id: number): CategoryRule | undefined;
  createRule(input: CategoryRuleWriteData): CategoryRule;
  updateRule(id: number, input: CategoryRuleWriteData): CategoryRule;
  deleteRule(id: number): void;

  // Reporting
  totalsByCategory(filter?: TransactionFilter): CategoryTotal[];
}
