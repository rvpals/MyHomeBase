import type Database from "better-sqlite3";
import type { DailySnapshotRepository } from "./ports";
import { dailySnapshotSchema } from "./schema";
import type { UpsertDailySnapshotInput } from "./schema";
import type { DailySnapshot } from "./types";

interface DailySnapshotRow {
  snapshot_date: string;
  stock_value_cents: number;
  etf_value_cents: number;
  other_value_cents: number;
  total_value_cents: number;
  stock_gain_loss_cents: number;
  etf_gain_loss_cents: number;
  other_gain_loss_cents: number;
  total_gain_loss_cents: number;
  position_count: number;
  created_at: string;
  updated_at: string;
}

function toDomain(row: DailySnapshotRow): DailySnapshot {
  return dailySnapshotSchema.parse({
    snapshotDate: row.snapshot_date,
    stockValueCents: row.stock_value_cents,
    etfValueCents: row.etf_value_cents,
    otherValueCents: row.other_value_cents,
    totalValueCents: row.total_value_cents,
    stockGainLossCents: row.stock_gain_loss_cents,
    etfGainLossCents: row.etf_gain_loss_cents,
    otherGainLossCents: row.other_gain_loss_cents,
    totalGainLossCents: row.total_gain_loss_cents,
    positionCount: row.position_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export class SqliteDailySnapshotRepository implements DailySnapshotRepository {
  constructor(private db: Database.Database) {}

  listSnapshots(range?: { fromDate: string; toDate: string }): DailySnapshot[] {
    // Dates are stored as YYYY-MM-DD, so a string BETWEEN is a correct date range
    // and rides the primary key.
    const rows = (
      range === undefined
        ? this.db.prepare("SELECT * FROM stk_daily_snapshots ORDER BY snapshot_date ASC").all()
        : this.db
            .prepare(
              `SELECT * FROM stk_daily_snapshots
               WHERE snapshot_date BETWEEN ? AND ?
               ORDER BY snapshot_date ASC`,
            )
            .all(range.fromDate, range.toDate)
    ) as DailySnapshotRow[];
    return rows.map(toDomain);
  }

  getSnapshot(snapshotDate: string): DailySnapshot | undefined {
    const row = this.db
      .prepare("SELECT * FROM stk_daily_snapshots WHERE snapshot_date = ?")
      .get(snapshotDate) as DailySnapshotRow | undefined;
    return row ? toDomain(row) : undefined;
  }

  upsertSnapshot(
    input: UpsertDailySnapshotInput,
    totals: { totalValueCents: number; totalGainLossCents: number },
  ): DailySnapshot {
    const row = this.db
      .prepare(
        `INSERT INTO stk_daily_snapshots
           (snapshot_date, stock_value_cents, etf_value_cents, other_value_cents, total_value_cents,
            stock_gain_loss_cents, etf_gain_loss_cents, other_gain_loss_cents, total_gain_loss_cents,
            position_count)
         VALUES
           (@snapshotDate, @stockValueCents, @etfValueCents, @otherValueCents, @totalValueCents,
            @stockGainLossCents, @etfGainLossCents, @otherGainLossCents, @totalGainLossCents,
            @positionCount)
         ON CONFLICT (snapshot_date) DO UPDATE SET
           stock_value_cents = excluded.stock_value_cents,
           etf_value_cents = excluded.etf_value_cents,
           other_value_cents = excluded.other_value_cents,
           total_value_cents = excluded.total_value_cents,
           stock_gain_loss_cents = excluded.stock_gain_loss_cents,
           etf_gain_loss_cents = excluded.etf_gain_loss_cents,
           other_gain_loss_cents = excluded.other_gain_loss_cents,
           total_gain_loss_cents = excluded.total_gain_loss_cents,
           position_count = excluded.position_count
         RETURNING *`,
      )
      .get({ ...input, ...totals }) as DailySnapshotRow;
    return toDomain(row);
  }

  deleteSnapshot(snapshotDate: string): void {
    this.db.prepare("DELETE FROM stk_daily_snapshots WHERE snapshot_date = ?").run(snapshotDate);
  }
}
