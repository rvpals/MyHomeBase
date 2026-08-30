import type Database from "better-sqlite3";
import type { ExpenseRepository, TransactionFilter } from "./ports";
import {
  creditCardAccountSchema,
  expenseCategorySchema,
  expenseVendorSchema,
  expenseTransactionSchema,
  postImportRuleSchema,
} from "./schema";
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

interface AccountRow {
  id: number;
  name: string;
  description: string;
  credit_line_cents: number;
  statement_close_day: number;
  card_image_mime_type: string | null;
  created_at: string;
  updated_at: string;
}

// Every normal account read lists columns explicitly and omits `card_image`, so
// the image bytes never ride along with a list or a page render. Only
// getAccountImage/setAccountImage touch that column.
const ACCOUNT_COLUMNS =
  "id, name, description, credit_line_cents, statement_close_day, card_image_mime_type, created_at, updated_at";

interface CategoryRow {
  name: string;
  description: string;
  icon_image_mime_type: string | null;
  created_at: string;
  updated_at: string;
}

// Same discipline as ACCOUNT_COLUMNS: every normal category read names its columns
// and omits `icon_image`, so the icon bytes never ride along with a list or a page
// render. Only getCategoryIcon/setCategoryIcon touch that column.
const CATEGORY_COLUMNS = "name, description, icon_image_mime_type, created_at, updated_at";

interface VendorRow {
  name: string;
  description: string;
  icon_image_mime_type: string | null;
  created_at: string;
  updated_at: string;
}

// Same discipline as CATEGORY_COLUMNS: no `icon_image` here, so the blob never
// rides along with a list or a page render.
const VENDOR_COLUMNS = "name, description, icon_image_mime_type, created_at, updated_at";

interface TransactionRow {
  id: number;
  transaction_date: string;
  posting_date: string;
  transaction_account_id: number;
  transaction_description: string;
  category_name: string;
  vendor: string;
  amount_cents: number;
  note: string;
  status: string;
  processed: number;
  created_by_user_id: number;
  created_at: string;
  updated_at: string;
}

interface RuleRow {
  id: number;
  name: string;
  description: string;
  pattern: string;
  priority: number;
  is_enabled: number;
  created_at: string;
  updated_at: string;
}

interface RuleActionRow {
  id: number;
  rule_id: number;
  field_name: string;
  field_value: string;
  sort_order: number;
}

function accountToDomain(row: AccountRow): CreditCardAccount {
  return creditCardAccountSchema.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    creditLineCents: row.credit_line_cents,
    statementCloseDay: row.statement_close_day,
    imageMimeType: row.card_image_mime_type ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function categoryToDomain(row: CategoryRow): ExpenseCategory {
  return expenseCategorySchema.parse({
    name: row.name,
    description: row.description,
    iconMimeType: row.icon_image_mime_type ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function vendorToDomain(row: VendorRow): ExpenseVendor {
  return expenseVendorSchema.parse({
    name: row.name,
    description: row.description,
    iconMimeType: row.icon_image_mime_type ?? undefined,
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
    vendor: row.vendor,
    amountCents: row.amount_cents,
    note: row.note,
    status: row.status,
    processed: row.processed === 1,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function ruleToDomain(row: RuleRow, actionRows: RuleActionRow[]): PostImportRule {
  return postImportRuleSchema.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    pattern: row.pattern,
    priority: row.priority,
    isEnabled: row.is_enabled === 1,
    actions: actionRows.map((action) => ({
      id: action.id,
      ruleId: action.rule_id,
      fieldName: action.field_name,
      fieldValue: action.field_value,
      sortOrder: action.sort_order,
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

/**
 * Domain field -> column for the fields a bulk edit may set. Iteration order
 * here decides the order of the SET clause, which is why it's a plain object
 * literal rather than being derived from the schema.
 */
const BULK_EDITABLE_COLUMNS: Record<keyof BulkTransactionEditData, string> = {
  transactionAccountId: "transaction_account_id",
  transactionDescription: "transaction_description",
  categoryName: "category_name",
  vendor: "vendor",
  note: "note",
  status: "status",
  processed: "processed",
};

/** The column behind each field a rule can assign, shared by both write paths. */
const RULE_FIELD_COLUMNS: Record<RuleActionField, string> = {
  categoryName: "category_name",
  vendor: "vendor",
  status: "status",
  note: "note",
};

/**
 * How many ids go into one statement. SQLite caps the bound parameters per
 * statement, and "select all" over a long grid can easily exceed it, so a bulk
 * operation is split into chunks run inside a single transaction — either the
 * whole selection lands or none of it does.
 */
const ID_CHUNK_SIZE = 500;

function chunkIds(ids: number[]): number[][] {
  const chunks: number[][] = [];
  for (let index = 0; index < ids.length; index += ID_CHUNK_SIZE) {
    chunks.push(ids.slice(index, index + ID_CHUNK_SIZE));
  }
  return chunks;
}

function placeholders(count: number): string {
  return new Array(count).fill("?").join(", ");
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
        `INSERT INTO exp_creditcard_accounts (name, description, credit_line_cents, statement_close_day)
         VALUES (@name, @description, @creditLineCents, @statementCloseDay)`,
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
         SET name = @name,
             description = @description,
             credit_line_cents = @creditLineCents,
             statement_close_day = @statementCloseDay
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
      .prepare(`SELECT ${CATEGORY_COLUMNS} FROM exp_categories ORDER BY name ASC`)
      .all() as CategoryRow[];
    return rows.map(categoryToDomain);
  }

  getCategoryByName(name: string): ExpenseCategory | undefined {
    const row = this.db
      .prepare(`SELECT ${CATEGORY_COLUMNS} FROM exp_categories WHERE name = ?`)
      .get(name) as CategoryRow | undefined;
    return row ? categoryToDomain(row) : undefined;
  }

  getCategoryIcon(name: string): CategoryIcon | undefined {
    const row = this.db
      .prepare("SELECT icon_image, icon_image_mime_type FROM exp_categories WHERE name = ?")
      .get(name) as { icon_image: Buffer | null; icon_image_mime_type: string | null } | undefined;
    if (!row || !row.icon_image || !row.icon_image_mime_type) return undefined;
    return { data: row.icon_image, mimeType: row.icon_image_mime_type };
  }

  setCategoryIcon(name: string, icon: CategoryIcon | undefined): void {
    this.db
      .prepare(
        "UPDATE exp_categories SET icon_image = ?, icon_image_mime_type = ? WHERE name = ?",
      )
      .run(icon?.data ?? null, icon?.mimeType ?? null, name);
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

  // --- vendors --------------------------------------------------------------
  //
  // Names match case-insensitively throughout (`COLLATE NOCASE`, backed by the
  // exp_vendors_name_nocase index from migration 0068), because vendorGroupKey
  // already upper-cases before grouping — so one rollup group must never be able
  // to match two rows. The stored spelling is preserved as typed.

  listVendors(): ExpenseVendor[] {
    const rows = this.db
      .prepare(`SELECT ${VENDOR_COLUMNS} FROM exp_vendors ORDER BY name ASC`)
      .all() as VendorRow[];
    return rows.map(vendorToDomain);
  }

  getVendorByName(name: string): ExpenseVendor | undefined {
    const row = this.db
      .prepare(`SELECT ${VENDOR_COLUMNS} FROM exp_vendors WHERE name = ? COLLATE NOCASE`)
      .get(name) as VendorRow | undefined;
    return row ? vendorToDomain(row) : undefined;
  }

  getVendorIcon(name: string): VendorIcon | undefined {
    const row = this.db
      .prepare(
        "SELECT icon_image, icon_image_mime_type FROM exp_vendors WHERE name = ? COLLATE NOCASE",
      )
      .get(name) as { icon_image: Buffer | null; icon_image_mime_type: string | null } | undefined;
    if (!row || !row.icon_image || !row.icon_image_mime_type) return undefined;
    return { data: row.icon_image, mimeType: row.icon_image_mime_type };
  }

  setVendorIcon(name: string, icon: VendorIcon | undefined): void {
    this.db
      .prepare(
        "UPDATE exp_vendors SET icon_image = ?, icon_image_mime_type = ? WHERE name = ? COLLATE NOCASE",
      )
      .run(icon?.data ?? null, icon?.mimeType ?? null, name);
  }

  upsertVendor(input: VendorWriteData): ExpenseVendor {
    // Case-insensitive by hand rather than through ON CONFLICT: the conflict
    // target is the PRIMARY KEY, which is case-*sensitive*, so saving "Costco"
    // over a stored "COSTCO" would insert a second row and trip the NOCASE
    // index instead of updating. Looking first also lets a re-save under a
    // different casing keep the original spelling rather than silently
    // rewriting it.
    return this.db.transaction(() => {
      const existing = this.getVendorByName(input.name);
      if (existing) {
        this.db
          .prepare("UPDATE exp_vendors SET description = ? WHERE name = ? COLLATE NOCASE")
          .run(input.description, existing.name);
      } else {
        this.db
          .prepare("INSERT INTO exp_vendors (name, description) VALUES (@name, @description)")
          .run(input);
      }
      const saved = this.getVendorByName(input.name);
      if (!saved) throw new Error(`Failed to read back vendor "${input.name}".`);
      return saved;
    })();
  }

  deleteVendor(name: string): void {
    // Only the row and its icon go. Unlike deleteCategory this leaves
    // exp_transactions.vendor alone: blanking it would throw away the tidied
    // name post-import processing worked out, and the vendor would vanish from
    // the rollups rather than simply losing its icon.
    this.db.prepare("DELETE FROM exp_vendors WHERE name = ? COLLATE NOCASE").run(name);
  }

  registerVendorsIfMissing(names: string[]): void {
    // NOCASE-guarded rather than INSERT OR IGNORE on the PK: a differently-cased
    // duplicate would pass the PK check and only then hit the unique index.
    const exists = this.db.prepare("SELECT 1 FROM exp_vendors WHERE name = ? COLLATE NOCASE");
    const insert = this.db.prepare("INSERT INTO exp_vendors (name) VALUES (?)");
    this.db.transaction(() => {
      for (const name of names) {
        if (name.trim() === "") continue;
        if (!exists.get(name)) insert.run(name);
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
            category_name, vendor, amount_cents, note, status, processed, created_by_user_id)
         VALUES
           (@transactionDate, @postingDate, @transactionAccountId, @transactionDescription,
            @categoryName, @vendor, @amountCents, @note, @status, @processed, @createdByUserId)`,
      )
      .run({ ...input, processed: input.processed ? 1 : 0, createdByUserId });
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
           vendor = @vendor,
           amount_cents = @amountCents,
           note = @note,
           status = @status,
           processed = @processed
         WHERE id = @id`,
      )
      .run({ ...input, processed: input.processed ? 1 : 0, id });
    const updated = this.getTransactionById(id);
    if (!updated) throw new Error(`Failed to read back transaction ${id}.`);
    return updated;
  }

  deleteTransaction(id: number): void {
    this.db.prepare("DELETE FROM exp_transactions WHERE id = ?").run(id);
  }

  deleteTransactions(ids: number[]): number {
    return this.db.transaction(() => {
      let deleted = 0;
      for (const chunk of chunkIds(ids)) {
        const result = this.db
          .prepare(`DELETE FROM exp_transactions WHERE id IN (${placeholders(chunk.length)})`)
          .run(chunk);
        deleted += result.changes;
      }
      return deleted;
    })();
  }

  bulkUpdateTransactions(ids: number[], changes: BulkTransactionEditData): number {
    // Built dynamically so a field the caller didn't name keeps its value —
    // the same approach as applyProcessingResult, but over a set of rows.
    const setClauses: string[] = [];
    const values: (string | number)[] = [];

    for (const [field, column] of Object.entries(BULK_EDITABLE_COLUMNS)) {
      const value = changes[field as keyof BulkTransactionEditData];
      if (value === undefined) continue;
      setClauses.push(`${column} = ?`);
      values.push(typeof value === "boolean" ? (value ? 1 : 0) : value);
    }
    if (setClauses.length === 0) return 0;

    return this.db.transaction(() => {
      let changed = 0;
      for (const chunk of chunkIds(ids)) {
        const result = this.db
          .prepare(
            `UPDATE exp_transactions SET ${setClauses.join(", ")}
             WHERE id IN (${placeholders(chunk.length)})`,
          )
          .run(...values, ...chunk);
        changed += result.changes;
      }
      return changed;
    })();
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

  listUnprocessed(limit: number): ExpenseTransaction[] {
    const rows = this.db
      .prepare("SELECT * FROM exp_transactions WHERE processed = 0 ORDER BY id ASC LIMIT ?")
      .all(limit) as TransactionRow[];
    return rows.map(transactionToDomain);
  }

  countUnprocessed(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM exp_transactions WHERE processed = 0")
      .get() as { count: number };
    return row.count;
  }

  applyProcessingResult(
    id: number,
    assignments: Partial<Record<RuleActionField, string>>,
  ): void {
    // Built dynamically so untouched columns keep their values, and always
    // marking processed in the same statement — a row can't end up changed but
    // still queued.
    const setClauses: string[] = ["processed = 1"];
    const params: Record<string, string | number> = { id };

    for (const [field, value] of Object.entries(assignments)) {
      if (value === undefined) continue;
      const column = RULE_FIELD_COLUMNS[field as RuleActionField];
      setClauses.push(`${column} = @${field}`);
      params[field] = value;
    }

    this.db
      .prepare(`UPDATE exp_transactions SET ${setClauses.join(", ")} WHERE id = @id`)
      .run(params);
  }

  forceApplyRuleAssignments(
    updates: { id: number; assignments: Partial<Record<RuleActionField, string>> }[],
  ): number {
    if (updates.length === 0) return 0;

    // One transaction for the whole run: a half-applied rule would leave the
    // user unable to tell which rows had been rewritten. Deliberately does not
    // touch `processed` — this path is outside the import queue.
    return this.db.transaction(() => {
      let changed = 0;
      for (const update of updates) {
        const setClauses: string[] = [];
        const params: Record<string, string | number> = { id: update.id };

        for (const [field, value] of Object.entries(update.assignments)) {
          if (value === undefined) continue;
          setClauses.push(`${RULE_FIELD_COLUMNS[field as RuleActionField]} = @${field}`);
          params[field] = value;
        }
        if (setClauses.length === 0) continue;

        const result = this.db
          .prepare(`UPDATE exp_transactions SET ${setClauses.join(", ")} WHERE id = @id`)
          .run(params);
        changed += result.changes;
      }
      return changed;
    })();
  }

  resetProcessedFlags(): number {
    const result = this.db.prepare("UPDATE exp_transactions SET processed = 0").run();
    return result.changes;
  }

  // --- rules ----------------------------------------------------------------

  listRules(): PostImportRule[] {
    // Evaluation order: lowest priority first, then insertion order.
    const rows = this.db
      .prepare("SELECT * FROM exp_post_import_rules ORDER BY priority ASC, id ASC")
      .all() as RuleRow[];
    if (rows.length === 0) return [];

    // One query for every action, grouped in memory, rather than a query per rule.
    const actionRows = this.db
      .prepare("SELECT * FROM exp_post_import_rule_actions ORDER BY rule_id ASC, sort_order ASC, id ASC")
      .all() as RuleActionRow[];
    const byRuleId = new Map<number, RuleActionRow[]>();
    for (const action of actionRows) {
      const existing = byRuleId.get(action.rule_id) ?? [];
      existing.push(action);
      byRuleId.set(action.rule_id, existing);
    }

    return rows.map((row) => ruleToDomain(row, byRuleId.get(row.id) ?? []));
  }

  getRuleById(id: number): PostImportRule | undefined {
    const row = this.db.prepare("SELECT * FROM exp_post_import_rules WHERE id = ?").get(id) as
      | RuleRow
      | undefined;
    if (!row) return undefined;
    const actionRows = this.db
      .prepare(
        "SELECT * FROM exp_post_import_rule_actions WHERE rule_id = ? ORDER BY sort_order ASC, id ASC",
      )
      .all(id) as RuleActionRow[];
    return ruleToDomain(row, actionRows);
  }

  /** Replaces a rule's action rows. Called inside a transaction by its callers. */
  private replaceRuleActions(ruleId: number, input: PostImportRuleWriteData): void {
    this.db.prepare("DELETE FROM exp_post_import_rule_actions WHERE rule_id = ?").run(ruleId);
    const insert = this.db.prepare(
      `INSERT INTO exp_post_import_rule_actions (rule_id, field_name, field_value, sort_order)
       VALUES (?, ?, ?, ?)`,
    );
    input.actions.forEach((action, index) => {
      insert.run(ruleId, action.fieldName, action.fieldValue, index);
    });
  }

  createRule(input: PostImportRuleWriteData): PostImportRule {
    const insertRule = this.db.prepare(
      `INSERT INTO exp_post_import_rules (name, description, pattern, priority, is_enabled)
       VALUES (@name, @description, @pattern, @priority, @isEnabled)`,
    );

    const ruleId = this.db.transaction(() => {
      const result = insertRule.run({
        name: input.name,
        description: input.description,
        pattern: input.pattern,
        priority: input.priority,
        isEnabled: input.isEnabled ? 1 : 0,
      });
      const newId = Number(result.lastInsertRowid);
      this.replaceRuleActions(newId, input);
      return newId;
    })();

    const created = this.getRuleById(ruleId);
    if (!created) throw new Error("Failed to read back the new rule.");
    return created;
  }

  updateRule(id: number, input: PostImportRuleWriteData): PostImportRule {
    const updateRule = this.db.prepare(
      `UPDATE exp_post_import_rules
       SET name = @name, description = @description, pattern = @pattern,
           priority = @priority, is_enabled = @isEnabled
       WHERE id = @id`,
    );

    this.db.transaction(() => {
      updateRule.run({
        id,
        name: input.name,
        description: input.description,
        pattern: input.pattern,
        priority: input.priority,
        isEnabled: input.isEnabled ? 1 : 0,
      });
      this.replaceRuleActions(id, input);
    })();

    const updated = this.getRuleById(id);
    if (!updated) throw new Error(`Failed to read back rule ${id}.`);
    return updated;
  }

  deleteRule(id: number): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM exp_post_import_rule_actions WHERE rule_id = ?").run(id);
      this.db.prepare("DELETE FROM exp_post_import_rules WHERE id = ?").run(id);
    })();
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
