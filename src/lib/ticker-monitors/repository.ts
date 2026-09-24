import type Database from "better-sqlite3";
import type { TickerMonitorRepository } from "./ports";
import type { CreateMonitor, UpdateMonitor } from "./schema";
import type { MonitorType, TickerMonitor } from "./types";

interface MonitorRow {
  id: number;
  ticker: string;
  monitor_type: string;
  target_cents: number;
  target_pct: number;
  band_pct: number;
  is_enabled: number;
  is_triggered: number;
  last_triggered_at: string | null;
  last_message: string;
  created_at: string;
  updated_at: string;
}

function toMonitor(row: MonitorRow): TickerMonitor {
  return {
    id: row.id,
    ticker: row.ticker,
    // Stored as text and narrowed here. The schema is what guarantees only the
    // three known values are ever written, so a row holding something else is a
    // hand-edited database rather than a case to branch on.
    monitorType: row.monitor_type as MonitorType,
    targetCents: row.target_cents,
    targetPct: row.target_pct,
    bandPct: row.band_pct,
    // SQLite has no boolean: 0/1 becomes a real boolean here so nothing above
    // this line tests an integer for truthiness.
    isEnabled: row.is_enabled === 1,
    isTriggered: row.is_triggered === 1,
    lastTriggeredAt: row.last_triggered_at ?? undefined,
    lastMessage: row.last_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Ticker monitor storage. See migrations/0110. */
export class SqliteTickerMonitorRepository implements TickerMonitorRepository {
  constructor(private readonly db: Database.Database) {}

  listByTicker(ticker: string): TickerMonitor[] {
    const rows = this.db
      .prepare("SELECT * FROM inv_ticker_monitors WHERE ticker = ? ORDER BY id")
      .all(ticker) as MonitorRow[];
    return rows.map(toMonitor);
  }

  listEnabled(): TickerMonitor[] {
    // Ordered by ticker so a run's messages arrive grouped by symbol rather
    // than interleaved by creation order.
    const rows = this.db
      .prepare("SELECT * FROM inv_ticker_monitors WHERE is_enabled = 1 ORDER BY ticker, id")
      .all() as MonitorRow[];
    return rows.map(toMonitor);
  }

  getById(id: number): TickerMonitor | undefined {
    const row = this.db.prepare("SELECT * FROM inv_ticker_monitors WHERE id = ?").get(id) as
      | MonitorRow
      | undefined;
    return row ? toMonitor(row) : undefined;
  }

  create(input: CreateMonitor): TickerMonitor {
    const row = this.db
      .prepare(
        `INSERT INTO inv_ticker_monitors
           (ticker, monitor_type, target_cents, target_pct, band_pct, is_enabled)
         VALUES (?, ?, ?, ?, ?, ?)
         RETURNING *`,
      )
      .get(
        input.ticker,
        input.monitorType,
        input.targetCents,
        input.targetPct,
        input.bandPct,
        input.isEnabled ? 1 : 0,
      ) as MonitorRow;
    return toMonitor(row);
  }

  update(input: UpdateMonitor): TickerMonitor {
    // The latch is deliberately reset on an edit: a monitor whose target just
    // moved has not reported *this* condition yet, so leaving it set would
    // swallow the first crossing of the new target.
    const row = this.db
      .prepare(
        `UPDATE inv_ticker_monitors
            SET ticker = ?, monitor_type = ?, target_cents = ?, target_pct = ?,
                band_pct = ?, is_enabled = ?, is_triggered = 0
          WHERE id = ?
         RETURNING *`,
      )
      .get(
        input.ticker,
        input.monitorType,
        input.targetCents,
        input.targetPct,
        input.bandPct,
        input.isEnabled ? 1 : 0,
        input.id,
      ) as MonitorRow | undefined;
    if (!row) throw new Error(`No monitor with id ${input.id}.`);
    return toMonitor(row);
  }

  setEnabled(id: number, isEnabled: boolean): void {
    this.db
      .prepare("UPDATE inv_ticker_monitors SET is_enabled = ? WHERE id = ?")
      .run(isEnabled ? 1 : 0, id);
  }

  delete(id: number): void {
    this.db.prepare("DELETE FROM inv_ticker_monitors WHERE id = ?").run(id);
  }

  setTriggered(id: number, isTriggered: boolean, message: string): void {
    // `last_triggered_at` and `last_message` are only written on the way *in*.
    // Clearing the latch leaves both alone, so the ticker's warning modal can
    // still say what was last reported and when.
    if (isTriggered) {
      this.db
        .prepare(
          `UPDATE inv_ticker_monitors
              SET is_triggered = 1, last_triggered_at = datetime('now'), last_message = ?
            WHERE id = ?`,
        )
        .run(message, id);
      return;
    }
    this.db.prepare("UPDATE inv_ticker_monitors SET is_triggered = 0 WHERE id = ?").run(id);
  }
}
