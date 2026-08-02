import type Database from "better-sqlite3";
import type { ExpenseRepository, TransactionFilter } from "./ports";
import {
  categoryRuleSchema,
  creditCardAccountSchema,
  expenseCategorySchema,
  expenseTransactionSchema,
} from "./schema";
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

interface AccountRow {
  id: number;
  name: string;
  description: string;
  credit_line_cents: number;
  card_image_mime_type: string | null;
  created_at: string;
  updated_at: string;
}

// Every normal account read lists columns explicitly and omits `card_image`, so
// the image bytes never ride along with a list or a page render. Only
// getAccountImage/setAccountImage touch that column.
const ACCOUNT_COLUMNS =
  "id, name, description, credit_line_cents, card_image_mime_type, created_at, updated_at";

interface CategoryRow {
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

interface TransactionRow {
  id: number;
  transaction_date: string;
  posting_date: string;
  transaction_account_id: number;
  transaction_description: string;
  category_name: string;
  amount_cents: number;
  note: string;
  status: string;
  created_by_user_id: number;
  created_at: string;
  updated_at: string;
}

interface RuleRow {
  id: number;
  pattern: string;
  category_name: string;
  apply_status: string;
  priority: number;
  is_enabled: number;
  created_at: string;
  updated_at: string;
}

function accountToDomain(row: AccountRow): CreditCardAccount {
  return creditCardAccountSchema.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    creditLineCents: row.credit_line_cents,
    imageMimeType: row.card_image_mime_type ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function categoryToDomain(row: CategoryRow): ExpenseCategory {
  return expenseCategorySchema.parse({
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function transactionToDomain(row: TransactionRow): ExpenseTransaction {
  return expenseTransactionSchema.parse({
    id: row.id,
    transactionDate: row.transaction_date,
    postingDate: row.posting_date,
    transactionAccountId: row.transaction_account_id,
    transactionDescription: row.transaction_description,
    categoryName: row.category_name,
    amountCents: row.amount_cents,
    note: row.note,
    status: row.status,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function ruleToDomain(row: RuleRow): CategoryRule {
  return categoryRuleSchema.parse({
    id: row.id,
    pattern: row.pattern,
    categoryName: row.category_name,
    applyStatus: row.apply_status,
    priority: row.priority,
    isEnabled: row.is_enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

/** Builds the shared WHERE clause for the transaction list and its totals. */
function buildFilter(filter: TransactionFilter = {}): {
  clause: string;
  params: Record<string, string | number>;
} {
  const conditions: string[] = [];
  const params: Record<string, string | number> = {};

  if (filter.accountId !== undefined) {
    conditions.push("transaction_account_id = @accountId");
    params.accountId = filter.accountId;
  }
  if (filter.categoryName !== undefined) {
    conditions.push("category_name = @categoryName");
    params.categoryName = filter.categoryName;
  }
  if (filter.status !== undefined) {
    conditions.push("status = @status");
    params.status = filter.status;
  }
  if (filter.fromDate !== undefined) {
    conditions.push("transaction_date >= @fromDate");
    params.fromDate = filter.fromDate;
  }
  if (filter.toDate !== undefined) {
    conditions.push("transaction_date <= @toDate");
    params.toDate = filter.toDate;
  }

  return { clause: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "", params };
}

// The real repository — the only place that talks to the exp_ tables.
export class SqliteExpenseRepository implements ExpenseRepository {
  constructor(private db: Database.Database) {}

  // --- accounts -------------------------------------------------------------

  listAccounts(): CreditCardAccount[] {
    const rows = this.db
      .prepare(`SELECT ${ACCOUNT_COLUMNS} FROM exp_creditcard_accounts ORDER BY name ASC`)
      .all() as AccountRow[];
    return rows.map(accountToDomain);
  }

  getAccountById(id: number): CreditCardAccount | undefined {
    const row = this.db
      .prepare(`SELECT ${ACCOUNT_COLUMNS} FROM exp_creditcard_accounts WHERE id = ?`)
      .get(id) as AccountRow | undefined;
    return row ? accountToDomain(row) : undefined;
  }

  getAccountImage(id: number): CardImage | undefined {
    const row = this.db
      .prepare("SELECT card_image, card_image_mime_type FROM exp_creditcard_accounts WHERE id = ?")
      .get(id) as { card_image: Buffer | null; card_image_mime_type: string | null } | undefined;
    if (!row || !row.card_image || !row.card_image_mime_type) return undefined;
    return { data: row.card_image, mimeType: row.card_image_mime_type };
  }

  setAccountImage(id: number, image: CardImage | undefined): void {
    this.db
      .prepare(
        "UPDATE exp_creditcard_accounts SET card_image = ?, card_image_mime_type = ? WHERE id = ?",
      )
      .run(image?.data ?? null, image?.mimeType ?? null, id);
  }

  createAccount(input: AccountWriteData): CreditCardAccount {
    const result = this.db
      .prepare(
        `INSERT INTO exp_creditcard_accounts (name, description, credit_line_cents)
         VALUES (@name, @description, @creditLineCents)`,
      )
      .run(input);
    const created = this.getAccountById(Number(result.lastInsertRowid));
    if (!created) throw new Error("Failed to read back the new credit-card account.");
    return created;
  }

  updateAccount(id: number, input: AccountWriteData): CreditCardAccount {
    this.db
      .prepare(
        `UPDATE exp_creditcard_accounts
         SET name = @name, description = @description, credit_line_cents = @creditLineCents
         WHERE id = @id`,
      )
      .run({ ...input, id });
    const updated = this.getAccountById(id);
    if (!updated) throw new Error(`Failed to read back credit-card account ${id}.`);
    return updated;
  }

  deleteAccount(id: number): void {
    this.db.prepare("DELETE FROM exp_creditcard_accounts WHERE id = ?").run(id);
  }

  countTransactionsForAccount(id: number): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM exp_transactions WHERE transaction_account_id = ?")
      .get(id) as { count: number };
    return row.count;
  }

  // --- categories -----------------------------------------------------------

  listCategories(): ExpenseCategory[] {
    const rows = this.db
      .prepare("SELECT * FROM exp_categories ORDER BY name ASC")
      .all() as CategoryRow[];
    return rows.map(categoryToDomain);
  }

  getCategoryByName(name: string): ExpenseCategory | undefined {
    const row = this.db.prepare("SELECT * FROM exp_categories WHERE name = ?").get(name) as
      | CategoryRow
      | undefined;
    return row ? categoryToDomain(row) : undefined;
  }

  upsertCategory(input: CategoryWriteData): ExpenseCategory {
    this.db
      .prepare(
        `INSERT INTO exp_categories (name, description) VALUES (@name, @description)
         ON CONFLICT(name) DO UPDATE SET description = excluded.description`,
      )
      .run(input);
    const saved = this.getCategoryByName(input.name);
    if (!saved) throw new Error(`Failed to read back category "${input.name}".`);
    return saved;
  }

  deleteCategory(name: string): void {
    this.db.transaction(() => {
      // Transactions keep their history; they just become uncategorised again.
      this.db
        .prepare("UPDATE exp_transactions SET category_name = '' WHERE category_name = ?")
        .run(name);
      this.db.prepare("DELETE FROM exp_categories WHERE name = ?").run(name);
    })();
  }

  registerCategoriesIfMissing(names: string[]): void {
    const insert = this.db.prepare("INSERT OR IGNORE INTO exp_categories (name) VALUES (?)");
    this.db.transaction(() => {
      for (const name of names) {
        if (name.trim() !== "") insert.run(name);
      }
    })();
  }

  // --- transactions ---------------------------------------------------------

  listTransactions(filter?: TransactionFilter): ExpenseTransaction[] {
    const { clause, params } = buildFilter(filter);
    const rows = this.db
      .prepare(
        `SELECT * FROM exp_transactions ${clause}
         ORDER BY transaction_date DESC, id DESC`,
      )
      .all(params) as TransactionRow[];
    return rows.map(transactionToDomain);
  }

  getTransactionById(id: number): ExpenseTransaction | undefined {
    const row = this.db.prepare("SELECT * FROM exp_transactions WHERE id = ?").get(id) as
      | TransactionRow
      | undefined;
    return row ? transactionToDomain(row) : undefined;
  }

  createTransaction(input: TransactionWriteData, createdByUserId: number): ExpenseTransaction {
    const result = this.db
      .prepare(
        `INSERT INTO exp_transactions
           (transaction_date, posting_date, transaction_account_id, transaction_description,
            category_name, amount_cents, note, status, created_by_user_id)
         VALUES
           (@transactionDate, @postingDate, @transactionAccountId, @transactionDescription,
            @categoryName, @amountCents, @note, @status, @createdByUserId)`,
      )
      .run({ ...input, createdByUserId });
    const created = this.getTransactionById(Number(result.lastInsertRowid));
    if (!created) throw new Error("Failed to read back the new transaction.");
    return created;
  }

  updateTransaction(id: number, input: TransactionWriteData): ExpenseTransaction {
    this.db
      .prepare(
        `UPDATE exp_transactions SET
           transaction_date = @transactionDate,
           posting_date = @postingDate,
           transaction_account_id = @transactionAccountId,
           transaction_description = @transactionDescription,
           category_name = @categoryName,
           amount_cents = @amountCents,
           note = @note,
           status = @status
         WHERE id = @id`,
      )
      .run({ ...input, id });
    const updated = this.getTransactionById(id);
    if (!updated) throw new Error(`Failed to read back transaction ${id}.`);
    return updated;
  }

  deleteTransaction(id: number): void {
    this.db.prepare("DELETE FROM exp_transactions WHERE id = ?").run(id);
  }

  transactionExists(input: {
    transactionAccountId: number;
    transactionDate: string;
    transactionDescription: string;
    amountCents: number;
  }): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 FROM exp_transactions
         WHERE transaction_account_id = @transactionAccountId
           AND transaction_date = @transactionDate
           AND transaction_description = @transactionDescription
           AND amount_cents = @amountCents
         LIMIT 1`,
      )
      .get(input);
    return row !== undefined;
  }

  setTransactionCategoryAndStatus(id: number, categoryName: string, status: string): void {
    this.db
      .prepare("UPDATE exp_transactions SET category_name = ?, status = ? WHERE id = ?")
      .run(categoryName, status, id);
  }

  // --- rules ----------------------------------------------------------------

  listRules(): CategoryRule[] {
    // Evaluation order: lowest priority first, then insertion order.
    const rows = this.db
      .prepare("SELECT * FROM exp_category_rules ORDER BY priority ASC, id ASC")
      .all() as RuleRow[];
    return rows.map(ruleToDomain);
  }

  getRuleById(id: number): CategoryRule | undefined {
    const row = this.db.prepare("SELECT * FROM exp_category_rules WHERE id = ?").get(id) as
      | RuleRow
      | undefined;
    return row ? ruleToDomain(row) : undefined;
  }

  createRule(input: CategoryRuleWriteData): CategoryRule {
    const result = this.db
      .prepare(
        `INSERT INTO exp_category_rules (pattern, category_name, apply_status, priority, is_enabled)
         VALUES (@pattern, @categoryName, @applyStatus, @priority, @isEnabled)`,
      )
      .run({ ...input, isEnabled: input.isEnabled ? 1 : 0 });
    const created = this.getRuleById(Number(result.lastInsertRowid));
    if (!created) throw new Error("Failed to read back the new rule.");
    return created;
  }

  updateRule(id: number, input: CategoryRuleWriteData): CategoryRule {
    this.db
      .prepare(
        `UPDATE exp_category_rules SET
           pattern = @pattern, category_name = @categoryName, apply_status = @applyStatus,
           priority = @priority, is_enabled = @isEnabled
         WHERE id = @id`,
      )
      .run({ ...input, isEnabled: input.isEnabled ? 1 : 0, id });
    const updated = this.getRuleById(id);
    if (!updated) throw new Error(`Failed to read back rule ${id}.`);
    return updated;
  }

  deleteRule(id: number): void {
    this.db.prepare("DELETE FROM exp_category_rules WHERE id = ?").run(id);
  }

  // --- reporting ------------------------------------------------------------

  totalsByCategory(filter?: TransactionFilter): CategoryTotal[] {
    const { clause, params } = buildFilter(filter);
    const rows = this.db
      .prepare(
        `SELECT category_name AS categoryName,
                SUM(amount_cents) AS totalCents,
                COUNT(*) AS transactionCount
         FROM exp_transactions ${clause}
         GROUP BY category_name
         ORDER BY SUM(amount_cents) DESC`,
      )
      .all(params) as CategoryTotal[];
    return rows;
  }
}
