import type Database from "better-sqlite3";
import type { InvestmentAccountRepository } from "./ports";
import { investmentAccountSchema, performanceRecordSchema } from "./schema";
import type {
  CreateInvestmentAccountInput,
  CreatePerformanceRecordInput,
  UpdateInvestmentAccountInput,
  UpdatePerformanceRecordInput,
} from "./schema";
import type { InvestmentAccount, PerformanceRecord } from "./types";

interface InvestmentAccountRow {
  id: number;
  name: string;
  description: string;
  initial_value_cents: number;
  last_value_cents: number | null;
  last_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

interface PerformanceRecordRow {
  id: number;
  account_id: number;
  total_value_cents: number;
  record_date: string;
  note: string;
  created_at: string;
  updated_at: string;
}

function accountToDomain(row: InvestmentAccountRow): InvestmentAccount {
  return investmentAccountSchema.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    initialValueCents: row.initial_value_cents,
    lastValueCents: row.last_value_cents ?? undefined,
    lastUpdatedAt: row.last_updated_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function performanceRecordToDomain(row: PerformanceRecordRow): PerformanceRecord {
  return performanceRecordSchema.parse({
    id: row.id,
    accountId: row.account_id,
    totalValueCents: row.total_value_cents,
    recordDate: row.record_date,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

// The real repository. Swap the database without touching any use-case.
export class SqliteInvestmentAccountRepository implements InvestmentAccountRepository {
  constructor(private db: Database.Database) {}

  listAccounts(): InvestmentAccount[] {
    const rows = this.db
      .prepare("SELECT * FROM investment_accounts ORDER BY created_at ASC")
      .all() as InvestmentAccountRow[];
    return rows.map(accountToDomain);
  }

  getAccountById(id: number): InvestmentAccount | undefined {
    const row = this.db.prepare("SELECT * FROM investment_accounts WHERE id = ?").get(id) as
      | InvestmentAccountRow
      | undefined;
    return row ? accountToDomain(row) : undefined;
  }

  createAccount(input: CreateInvestmentAccountInput): InvestmentAccount {
    const result = this.db
      .prepare(
        `INSERT INTO investment_accounts (name, description, initial_value_cents)
         VALUES (@name, @description, @initialValueCents)`,
      )
      .run(input);

    const created = this.getAccountById(Number(result.lastInsertRowid));
    if (!created) throw new Error("Failed to read back newly created investment account.");
    return created;
  }

  updateAccount(id: number, input: UpdateInvestmentAccountInput): InvestmentAccount {
    this.db
      .prepare(
        `UPDATE investment_accounts
         SET name = @name, description = @description, initial_value_cents = @initialValueCents
         WHERE id = @id`,
      )
      .run({ ...input, id });

    const updated = this.getAccountById(id);
    if (!updated) throw new Error(`Failed to read back updated investment account ${id}.`);
    return updated;
  }

  deleteAccount(id: number): void {
    const deletePerformance = this.db.prepare(
      "DELETE FROM account_performance_records WHERE account_id = ?",
    );
    const deleteAccount = this.db.prepare("DELETE FROM investment_accounts WHERE id = ?");
    this.db.transaction(() => {
      deletePerformance.run(id);
      deleteAccount.run(id);
    })();
  }

  listPerformanceRecords(accountId?: number): PerformanceRecord[] {
    const rows = (
      accountId === undefined
        ? this.db
            .prepare("SELECT * FROM account_performance_records ORDER BY record_date ASC")
            .all()
        : this.db
            .prepare(
              "SELECT * FROM account_performance_records WHERE account_id = ? ORDER BY record_date ASC",
            )
            .all(accountId)
    ) as PerformanceRecordRow[];
    return rows.map(performanceRecordToDomain);
  }

  getPerformanceRecordById(id: number): PerformanceRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM account_performance_records WHERE id = ?")
      .get(id) as PerformanceRecordRow | undefined;
    return row ? performanceRecordToDomain(row) : undefined;
  }

  addPerformanceRecord(input: CreatePerformanceRecordInput): PerformanceRecord {
    const row = this.db
      .prepare(
        `INSERT INTO account_performance_records (account_id, total_value_cents, record_date, note)
         VALUES (@accountId, @totalValueCents, @recordDate, @note)
         ON CONFLICT (account_id, record_date) DO UPDATE SET
           total_value_cents = excluded.total_value_cents,
           note = excluded.note
         RETURNING *`,
      )
      .get(input) as PerformanceRecordRow;

    this.syncAccountLastValue(input.accountId);
    return performanceRecordToDomain(row);
  }

  updatePerformanceRecord(id: number, input: UpdatePerformanceRecordInput): PerformanceRecord {
    const existing = this.getPerformanceRecordById(id);
    if (!existing) throw new Error(`No performance record with id ${id}.`);

    this.db
      .prepare(
        `UPDATE account_performance_records
         SET total_value_cents = @totalValueCents, record_date = @recordDate, note = @note
         WHERE id = @id`,
      )
      .run({ ...input, id });

    this.syncAccountLastValue(existing.accountId);
    const updated = this.getPerformanceRecordById(id);
    if (!updated) throw new Error(`Failed to read back updated performance record ${id}.`);
    return updated;
  }

  deletePerformanceRecord(id: number): void {
    const existing = this.getPerformanceRecordById(id);
    if (!existing) return;

    this.db.prepare("DELETE FROM account_performance_records WHERE id = ?").run(id);
    this.syncAccountLastValue(existing.accountId);
  }

  addPerformanceRecordIfNotExists(
    input: CreatePerformanceRecordInput,
  ): { inserted: boolean; record?: PerformanceRecord } {
    const row = this.db
      .prepare(
        `INSERT OR IGNORE INTO account_performance_records (account_id, total_value_cents, record_date, note)
         VALUES (@accountId, @totalValueCents, @recordDate, @note)
         RETURNING *`,
      )
      .get(input) as PerformanceRecordRow | undefined;

    if (!row) return { inserted: false };
    this.syncAccountLastValue(input.accountId);
    return { inserted: true, record: performanceRecordToDomain(row) };
  }

  // Keeps investment_accounts.last_value_cents/last_updated_at in sync with the
  // most recent performance record for that account — see migration 0015.
  private syncAccountLastValue(accountId: number): void {
    const latest = this.db
      .prepare(
        `SELECT total_value_cents, record_date FROM account_performance_records
         WHERE account_id = ? ORDER BY record_date DESC LIMIT 1`,
      )
      .get(accountId) as { total_value_cents: number; record_date: string } | undefined;

    this.db
      .prepare(
        "UPDATE investment_accounts SET last_value_cents = ?, last_updated_at = ? WHERE id = ?",
      )
      .run(latest?.total_value_cents ?? null, latest?.record_date ?? null, accountId);
  }
}
