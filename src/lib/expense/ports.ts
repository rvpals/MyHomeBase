import type {
  AccountWriteData,
  BulkTransactionEditData,
  CategoryWriteData,
  PostImportRuleWriteData,
  TransactionWriteData,
  VendorWriteData,
} from "./schema";
import type {
  CardImage,
  CategoryIcon,
  CategoryTotal,
  CreditCardAccount,
  ExpenseCategory,
  ExpenseTransaction,
  ExpenseVendor,
  PostImportRule,
  RuleActionField,
  VendorIcon,
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

  // Vendors
  //
  // The saved side of a vendor only. The spend rollups (`vendorTotals`) stay
  // derived from the transactions and need no row here, so a vendor can be
  // absent from this table and still appear on every screen.
  listVendors(): ExpenseVendor[];
  /** Matched case-insensitively, so "Costco" finds a row stored as "COSTCO". */
  getVendorByName(name: string): ExpenseVendor | undefined;
  upsertVendor(input: VendorWriteData): ExpenseVendor;
  /**
   * Deletes the vendor row and its icon. Transactions keep their `vendor` text,
   * so the name reappears as a derived-only vendor.
   */
  deleteVendor(name: string): void;
  /** Insert-if-absent, so a name used on a transaction always has a row. */
  registerVendorsIfMissing(names: string[]): void;
  /** Reads the icon bytes. Only the icon-serving route calls this. */
  getVendorIcon(name: string): VendorIcon | undefined;
  /** Passing undefined clears the icon. */
  setVendorIcon(name: string, icon: VendorIcon | undefined): void;

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
  /**
   * Writes assignments to many rows at once, overwriting what's there and
   * leaving the processed flag alone — the deliberate "run this rule over the
   * back catalogue" path, which isn't part of the import queue. Returns how
   * many rows were written.
   */
  forceApplyRuleAssignments(
    updates: { id: number; assignments: Partial<Record<RuleActionField, string>> }[],
  ): number;

  // Rules
  listRules(): PostImportRule[];
  getRuleById(id: number): PostImportRule | undefined;
  createRule(input: PostImportRuleWriteData): PostImportRule;
  updateRule(id: number, input: PostImportRuleWriteData): PostImportRule;
  deleteRule(id: number): void;

  // Reporting
  totalsByCategory(filter?: TransactionFilter): CategoryTotal[];
}
