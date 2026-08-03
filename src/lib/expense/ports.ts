import type {
  AccountWriteData,
  BulkTransactionEditData,
  CategoryWriteData,
  PostImportRuleWriteData,
  TransactionWriteData,
} from "./schema";
import type {
  CardImage,
  CategoryIcon,
  CategoryTotal,
  CreditCardAccount,
  ExpenseCategory,
  ExpenseTransaction,
  PostImportRule,
  RuleActionField,
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
  /** Reads the icon bytes. Only the icon-serving route calls this. */
  getCategoryIcon(name: string): CategoryIcon | undefined;
  /** Passing undefined clears the icon. */
  setCategoryIcon(name: string, icon: CategoryIcon | undefined): void;

  // Transactions
  listTransactions(filter?: TransactionFilter): ExpenseTransaction[];
  getTransactionById(id: number): ExpenseTransaction | undefined;
  createTransaction(input: TransactionWriteData, createdByUserId: number): ExpenseTransaction;
  updateTransaction(id: number, input: TransactionWriteData): ExpenseTransaction;
  deleteTransaction(id: number): void;
  /** Deletes many rows in one go, returning how many actually went. */
  deleteTransactions(ids: number[]): number;
  /**
   * Writes the same values to every listed row, all in one statement. Fields
   * absent from `changes` keep their current values. Returns the row count
   * affected.
   */
  bulkUpdateTransactions(ids: number[], changes: BulkTransactionEditData): number;
  /** True when an identical row already exists — used to skip re-imports. */
  transactionExists(input: {
    transactionAccountId: number;
    transactionDate: string;
    transactionDescription: string;
    amountCents: number;
  }): boolean;
  /**
   * The next `limit` transactions still awaiting post-import processing,
   * oldest first — the clean-up queue.
   */
  listUnprocessed(limit: number): ExpenseTransaction[];
  countUnprocessed(): number;
  /**
   * Writes a rule's assignments and marks the row processed, in one statement.
   * An empty `assignments` map just marks it processed.
   */
  applyProcessingResult(
    id: number,
    assignments: Partial<Record<RuleActionField, string>>,
  ): void;
  /** Clears the processed flag so the rules can be run over rows again. */
  resetProcessedFlags(): number;

  // Rules
  listRules(): PostImportRule[];
  getRuleById(id: number): PostImportRule | undefined;
  createRule(input: PostImportRuleWriteData): PostImportRule;
  updateRule(id: number, input: PostImportRuleWriteData): PostImportRule;
  deleteRule(id: number): void;

  // Reporting
  totalsByCategory(filter?: TransactionFilter): CategoryTotal[];
}
