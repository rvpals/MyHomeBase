import type Database from "better-sqlite3";
import type { CalculatorHistoryRepository } from "./ports";
import { HISTORY_LIMIT } from "./schema";
import type { CalculationEntry } from "./types";

interface HistoryRow {
  id: number;
  expression: string;
  result: string;
  created_at: string;
}

/** Rows to domain types — the repository never hands a caller a raw row. */
function toEntry(row: HistoryRow): CalculationEntry {
  return {
    id: row.id,
    expression: row.expression,
    result: row.result,
    createdAt: row.created_at,
  };
}

/**
 * The only file in the calculator that knows SQL.
 *
 * Every statement is scoped by `user_id`. A calculator tape is private working-out
 * rather than a shared board like `gam_scores`, so the owner is part of every query's
 * identity and there is no method that can read across users.
 */
export class SqliteCalculatorHistoryRepository implements CalculatorHistoryRepository {
  constructor(private readonly db: Database.Database) {}

  record(userId: number, expression: string, result: string): CalculationEntry {
    // Insert and prune in one transaction: without it, a crash between the two would
    // leave the tape one row over its cap forever, and two quick calculations could
    // interleave into a double-prune.
    const write = this.db.transaction((): CalculationEntry => {
      const inserted = this.db
        .prepare(
          `INSERT INTO sys_calculator_history (user_id, expression, result, created_at)
           VALUES (?, ?, ?, datetime('now'))`,
        )
        .run(userId, expression, result);

      // Keep the newest HISTORY_LIMIT rows for this user and drop the rest.
      //
      // Ordered by `id DESC`, not `created_at DESC`: `datetime('now')` has one-second
      // resolution, so several calculations in the same second are indistinguishable by
      // timestamp and the prune could drop the wrong one. The id is monotonic and
      // unambiguous.
      this.db
        .prepare(
          `DELETE FROM sys_calculator_history
           WHERE user_id = ?
             AND id NOT IN (
               SELECT id FROM sys_calculator_history
               WHERE user_id = ?
               ORDER BY id DESC
               LIMIT ?
             )`,
        )
        .run(userId, userId, HISTORY_LIMIT);

      const row = this.db
        .prepare(
          `SELECT id, expression, result, created_at
           FROM sys_calculator_history WHERE id = ?`,
        )
        .get(Number(inserted.lastInsertRowid)) as HistoryRow | undefined;

      // Inserted on this connection a moment ago, so it cannot miss — checked rather
      // than asserted away, since a non-null assertion would turn a future change in
      // the SELECT into a confusing crash.
      if (!row) throw new Error("Failed to read back the calculation just recorded.");
      return toEntry(row);
    });

    return write();
  }

  list(userId: number, limit: number): CalculationEntry[] {
    const rows = this.db
      .prepare(
        `SELECT id, expression, result, created_at
         FROM sys_calculator_history
         WHERE user_id = ?
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(userId, limit) as HistoryRow[];
    return rows.map(toEntry);
  }

  clear(userId: number): void {
    this.db.prepare(`DELETE FROM sys_calculator_history WHERE user_id = ?`).run(userId);
  }
}
