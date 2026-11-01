import type Database from "better-sqlite3";

import type { SystemLogRepository } from "./ports";
import { systemLogKindSchema, type WriteSystemLog } from "./schema";
import type { SystemLogCounts, SystemLogEntry, SystemLogFilter, SystemLogKind } from "./types";

interface SystemLogRow {
  id: number;
  created_at: string;
  kind: string;
  source: string;
  message: string;
  detail: string;
}

/**
 * A stored kind to the domain enum, falling back to `debug` for anything
 * unrecognised rather than throwing.
 *
 * The column is TEXT with no CHECK constraint (migrations/0167), so a row written by
 * hand through the SQL Explorer could hold anything. A read of the log must not fail
 * because one row is malformed — same reasoning, and the same shape, as
 * `readModule` in `lib/messages/repository.ts`.
 *
 * `debug` rather than `operational` is the safer fallback: a junk row showing up
 * under the noisy, short-lived half is less misleading than one claiming to be a
 * record of something the system did.
 */
function readKind(value: string): SystemLogKind {
  const parsed = systemLogKindSchema.safeParse(value);
  return parsed.success ? parsed.data : "debug";
}

function toEntry(row: SystemLogRow): SystemLogEntry {
  return {
    id: row.id,
    createdAt: row.created_at,
    kind: readKind(row.kind),
    source: row.source,
    message: row.message,
    detail: row.detail,
  };
}

/**
 * How often the prune actually counts rows.
 *
 * The contract is that the table stays bounded, not that every insert pays for a
 * `COUNT(*)` and a `DELETE`. One insert in fifty does the work, which on a job
 * writing a line per document is the difference between a log that costs nothing and
 * one that doubles the pass.
 *
 * The consequence is that the table may sit up to this many rows over its cap, which
 * is why the cap is a soft ceiling in the settings description rather than a promise.
 */
const PRUNE_EVERY = 50;

export class SqliteSystemLogRepository implements SystemLogRepository {
  private writesSincePrune = 0;

  constructor(private readonly db: Database.Database) {}

  /**
   * Appends one line.
   *
   * `created_at` is left to the column's default so the database stamps it — see
   * migrations/0167. Passing one from here would put the app's clock in the log and
   * let a caller supply a time of its own.
   */
  write(entry: WriteSystemLog, maxRows: number): void {
    this.db
      .prepare(
        `INSERT INTO sys_system_log (kind, source, message, detail)
         VALUES (?, ?, ?, ?)`,
      )
      .run(entry.kind, entry.source, entry.message, entry.detail);

    this.writesSincePrune += 1;
    if (this.writesSincePrune >= PRUNE_EVERY) {
      this.writesSincePrune = 0;
      this.prune(maxRows);
    }
  }

  /**
   * Drops the oldest lines past the cap.
   *
   * Deletes by `id` rather than by age: the cap is a row count, and `id` is
   * monotonic, so "keep the newest N" is one subquery against the index 0167
   * created. An age-based rule would need a second index and would not bound the
   * table at all on a job that writes a thousand lines in a minute.
   *
   * A `maxRows` of 0 or less means "do not prune" — the logger passes that when it
   * could not read the settings at all, and deleting the whole log because a
   * settings read failed would be the wrong way round.
   */
  private prune(maxRows: number): void {
    if (maxRows <= 0) return;
    this.db
      .prepare(
        `DELETE FROM sys_system_log
          WHERE id <= (
            SELECT id FROM sys_system_log ORDER BY id DESC LIMIT 1 OFFSET ?
          )`,
      )
      .run(maxRows);
  }

  list(filter: SystemLogFilter): SystemLogEntry[] {
    const where: string[] = [];
    const params: (string | number)[] = [];

    if (filter.kind !== undefined) {
      where.push("kind = ?");
      params.push(filter.kind);
    }

    const search = filter.search?.trim() ?? "";
    if (search !== "") {
      // Matches either half: a reader looking for "text-index" means the source, and
      // one looking for a filename means the message. Asking which they meant would
      // be a second control on a screen whose whole job is to be glanced at.
      //
      // LIKE with escaped wildcards rather than FTS: this table has no FTS index by
      // design (0167 keeps exactly one index), the result set is already capped at a
      // few hundred rows, and a substring is what a reader actually types.
      where.push("(source LIKE ? ESCAPE '\\' OR message LIKE ? ESCAPE '\\')");
      const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
      params.push(pattern, pattern);
    }

    const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `SELECT id, created_at, kind, source, message, detail
           FROM sys_system_log
           ${clause}
          ORDER BY id DESC
          LIMIT ?`,
      )
      .all(...params, filter.limit) as SystemLogRow[];

    return rows.map(toEntry);
  }

  counts(): SystemLogCounts {
    const rows = this.db
      .prepare(`SELECT kind, COUNT(*) AS count FROM sys_system_log GROUP BY kind`)
      .all() as { kind: string; count: number }[];

    let debug = 0;
    let operational = 0;
    for (const row of rows) {
      if (readKind(row.kind) === "debug") debug += row.count;
      else operational += row.count;
    }
    return { debug, operational, total: debug + operational };
  }

  clear(kind?: SystemLogKind): number {
    const result =
      kind === undefined
        ? this.db.prepare(`DELETE FROM sys_system_log`).run()
        : this.db.prepare(`DELETE FROM sys_system_log WHERE kind = ?`).run(kind);
    return result.changes;
  }
}
