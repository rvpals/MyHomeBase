import type Database from "better-sqlite3";
import type { HsaExpenseData } from "./hsa-schema";
import type { HsaRepository } from "./hsa-ports";
import { HSA_TYPES, type HsaCard, type HsaExpense, type HsaType } from "./hsa-types";

interface ExpenseRow {
  id: number;
  entry_date: string;
  entry_time: string;
  amount_cents: number;
  product_service: string;
  type: string;
  payee: string;
  service_date: string | null;
  paid_with: string;
  note: string;
  is_reimbursed: number;
  receipt_path: string | null;
  receipt_file_name: string;
  receipt_mime_type: string | null;
  created_at: string;
  updated_at: string;
}

interface CardRow {
  id: number;
  name: string;
  is_active: number;
  created_at: string;
}

/** Every column. The receipt itself is a file in the receipt folder, not a column. */
const EXPENSE_COLUMNS = `
  id, entry_date, entry_time, amount_cents, product_service, type, payee,
  service_date, paid_with, note, is_reimbursed,
  receipt_path, receipt_file_name, receipt_mime_type, created_at, updated_at
`;

function toType(value: string): HsaType {
  // A hand-edited row could hold anything; show it as Other rather than crash.
  return (HSA_TYPES as readonly string[]).includes(value) ? (value as HsaType) : "Other";
}

function toExpense(row: ExpenseRow): HsaExpense {
  return {
    id: row.id,
    entryDate: row.entry_date,
    entryTime: row.entry_time,
    amountCents: row.amount_cents,
    productService: row.product_service,
    type: toType(row.type),
    payee: row.payee,
    serviceDate: row.service_date,
    paidWith: row.paid_with,
    note: row.note,
    isReimbursed: row.is_reimbursed === 1,
    hasReceipt: (row.receipt_path ?? "") !== "",
    receiptPath: row.receipt_path ?? "",
    receiptFileName: row.receipt_file_name,
    receiptMimeType: row.receipt_mime_type ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCard(row: CardRow): HsaCard {
  return {
    id: row.id,
    name: row.name,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
  };
}

export class SqliteHsaRepository implements HsaRepository {
  constructor(private readonly db: Database.Database) {}

  listExpenses(): HsaExpense[] {
    const rows = this.db
      .prepare(
        `SELECT ${EXPENSE_COLUMNS} FROM hsh_hsa_expenses
          ORDER BY entry_date DESC, entry_time DESC, id DESC`,
      )
      .all() as ExpenseRow[];
    return rows.map(toExpense);
  }

  getExpenseById(id: number): HsaExpense | undefined {
    const row = this.db
      .prepare(`SELECT ${EXPENSE_COLUMNS} FROM hsh_hsa_expenses WHERE id = ?`)
      .get(id) as ExpenseRow | undefined;
    return row ? toExpense(row) : undefined;
  }

  createExpense(input: HsaExpenseData): HsaExpense {
    const result = this.db
      .prepare(
        `INSERT INTO hsh_hsa_expenses
           (entry_date, entry_time, amount_cents, product_service, type, payee,
            service_date, paid_with, note, is_reimbursed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.entryDate,
        input.entryTime,
        input.amountCents,
        input.productService,
        input.type,
        input.payee,
        input.serviceDate,
        input.paidWith,
        input.note,
        input.isReimbursed ? 1 : 0,
      );
    // Non-null: the row was just inserted.
    return this.getExpenseById(Number(result.lastInsertRowid))!;
  }

  updateExpense(id: number, input: HsaExpenseData): HsaExpense | undefined {
    const result = this.db
      .prepare(
        `UPDATE hsh_hsa_expenses
            SET entry_date = ?, entry_time = ?, amount_cents = ?, product_service = ?,
                type = ?, payee = ?, service_date = ?, paid_with = ?, note = ?,
                is_reimbursed = ?
          WHERE id = ?`,
      )
      .run(
        input.entryDate,
        input.entryTime,
        input.amountCents,
        input.productService,
        input.type,
        input.payee,
        input.serviceDate,
        input.paidWith,
        input.note,
        input.isReimbursed ? 1 : 0,
        id,
      );
    return result.changes === 0 ? undefined : this.getExpenseById(id);
  }

  deleteExpenses(ids: number[]): number {
    const removeMany = this.db.transaction((expenseIds: number[]): number => {
      const remove = this.db.prepare(`DELETE FROM hsh_hsa_expenses WHERE id = ?`);
      let removed = 0;
      // An id that no longer exists counts 0 — a stale selection is not an error.
      for (const id of expenseIds) removed += remove.run(id).changes;
      return removed;
    });
    return removeMany(ids);
  }

  setReimbursed(ids: number[], isReimbursed: boolean): number {
    const apply = this.db.transaction((expenseIds: number[]): number => {
      const update = this.db.prepare(`UPDATE hsh_hsa_expenses SET is_reimbursed = ? WHERE id = ?`);
      let changed = 0;
      for (const id of expenseIds) changed += update.run(isReimbursed ? 1 : 0, id).changes;
      return changed;
    });
    return apply(ids);
  }

  setReceipt(id: number, receipt: { path: string; mimeType: string; fileName: string }): void {
    this.db
      .prepare(
        `UPDATE hsh_hsa_expenses
            SET receipt_path = ?, receipt_mime_type = ?, receipt_file_name = ?
          WHERE id = ?`,
      )
      .run(receipt.path, receipt.mimeType, receipt.fileName, id);
  }

  setReceiptPath(id: number, path: string): void {
    this.db.prepare(`UPDATE hsh_hsa_expenses SET receipt_path = ? WHERE id = ?`).run(path, id);
  }

  clearReceipt(id: number): void {
    this.db
      .prepare(
        `UPDATE hsh_hsa_expenses
            SET receipt_path = NULL, receipt_mime_type = NULL, receipt_file_name = 
          WHERE id = ?`,
      )
      .run(id);
  }

  listProductServices(): string[] {
    // `GROUP BY ... COLLATE NOCASE` folds "Prescription" and "prescription" into one
    // entry; MIN() picks one spelling deterministically.
    const rows = this.db
      .prepare(
        `SELECT MIN(product_service) AS name
           FROM hsh_hsa_expenses
          WHERE product_service <> ''
          GROUP BY product_service COLLATE NOCASE
          ORDER BY name COLLATE NOCASE`,
      )
      .all() as { name: string }[];
    return rows.map((row) => row.name);
  }

  listPayees(): string[] {
    // Same shape as listProductServices: grouped COLLATE NOCASE so "CVS" and "cvs"
    // are one entry, with MIN() picking a single spelling deterministically.
    const rows = this.db
      .prepare(
        `SELECT MIN(payee) AS name
           FROM hsh_hsa_expenses
          WHERE payee <> ''
          GROUP BY payee COLLATE NOCASE
          ORDER BY name COLLATE NOCASE`,
      )
      .all() as { name: string }[];
    return rows.map((row) => row.name);
  }

  listCards(): HsaCard[] {
    const rows = this.db
      .prepare(`SELECT id, name, is_active, created_at FROM hsh_hsa_cards ORDER BY name COLLATE NOCASE`)
      .all() as CardRow[];
    return rows.map(toCard);
  }

  getCardById(id: number): HsaCard | undefined {
    const row = this.db
      .prepare(`SELECT id, name, is_active, created_at FROM hsh_hsa_cards WHERE id = ?`)
      .get(id) as CardRow | undefined;
    return row ? toCard(row) : undefined;
  }

  createCard(name: string): HsaCard {
    this.assertNameFree(name);
    const result = this.db.prepare(`INSERT INTO hsh_hsa_cards (name) VALUES (?)`).run(name);
    return this.getCardById(Number(result.lastInsertRowid))!;
  }

  renameCard(id: number, name: string): HsaCard | undefined {
    if (!this.getCardById(id)) return undefined;
    this.assertNameFree(name, id);
    this.db.prepare(`UPDATE hsh_hsa_cards SET name = ? WHERE id = ?`).run(name, id);
    return this.getCardById(id);
  }

  setCardActive(id: number, isActive: boolean): HsaCard | undefined {
    const result = this.db
      .prepare(`UPDATE hsh_hsa_cards SET is_active = ? WHERE id = ?`)
      .run(isActive ? 1 : 0, id);
    return result.changes === 0 ? undefined : this.getCardById(id);
  }

  deleteCard(id: number): void {
    this.db.prepare(`DELETE FROM hsh_hsa_cards WHERE id = ?`).run(id);
  }

  /** Checked up front so the message names the problem, rather than a raw constraint error. */
  private assertNameFree(name: string, exceptId?: number): void {
    const row = this.db
      .prepare(`SELECT id FROM hsh_hsa_cards WHERE name = ? COLLATE NOCASE`)
      .get(name) as { id: number } | undefined;
    if (row && row.id !== exceptId) throw new Error(`A card named "${name}" already exists.`);
  }
}
