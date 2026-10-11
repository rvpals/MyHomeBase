import type Database from "better-sqlite3";
import { scheduledRunSchema } from "./schema";
import type { ScheduledRunRepository } from "./ports";
import {
  HISTORY_LIMIT_PER_JOB,
  type ScheduledRun,
  type ScheduledRunHistoryEntry,
  type ScheduledRunStatus,
} from "./types";

interface ScheduledRunRow {
  job_key: string;
  last_run_at: string;
  last_status: string | null;
  last_detail: string | null;
}

interface ScheduledRunHistoryRow {
  id: number;
  job_key: string;
  started_at: string;
  finished_at: string | null;
  status: string | null;
  detail: string | null;
}

function toDomain(row: ScheduledRunRow): ScheduledRun {
  return scheduledRunSchema.parse({
    jobKey: row.job_key,
    lastRunAt: row.last_run_at,
    status: row.last_status ?? undefined,
    detail: row.last_detail ?? undefined,
  });
}

// The real repository. Swap the database without touching any use-case.
export class SqliteScheduledRunRepository implements ScheduledRunRepository {
  constructor(private db: Database.Database) {}

  get(jobKey: string): ScheduledRun | undefined {
    const row = this.db
      .prepare("SELECT * FROM sys_scheduled_runs WHERE job_key = ?")
      .get(jobKey) as ScheduledRunRow | undefined;
    return row ? toDomain(row) : undefined;
  }

  /**
   * Every row, unordered by design: the admin screen lists jobs in
   * `JOB_DESCRIPTORS` order, not in whatever order they last happened to run.
   */
  list(): ScheduledRun[] {
    const rows = this.db.prepare("SELECT * FROM sys_scheduled_runs").all() as ScheduledRunRow[];
    return rows.map(toDomain);
  }

  /**
   * One upsert against the primary key -- no select-then-write, which is the
   * point of keying the table on `job_key` (see migrations/0061).
   *
   * The outcome columns are cleared on start so a row can never show a fresh
   * timestamp beside the *previous* run's status, which would read as though the
   * new pass had already succeeded.
   */
  start(jobKey: string, startedAt: string): void {
    this.db
      .prepare(
        `INSERT INTO sys_scheduled_runs (job_key, last_run_at, last_status, last_detail)
         VALUES (?, ?, NULL, NULL)
         ON CONFLICT (job_key) DO UPDATE SET
           last_run_at = excluded.last_run_at,
           last_status = NULL,
           last_detail = NULL`,
      )
      .run(jobKey, startedAt);

    // History is written HERE rather than in the runners (migrations/0135). All five
    // runners already call this method, so every job gains history without a single
    // runner change -- and no job added later can forget to record itself.
    this.db
      .prepare(
        `INSERT INTO sys_scheduled_run_history (job_key, started_at, finished_at, status, detail)
         VALUES (?, ?, NULL, NULL, NULL)`,
      )
      .run(jobKey, startedAt);

    this.pruneHistory(jobKey);
  }

  /**
   * Drops this job's passes beyond `HISTORY_LIMIT_PER_JOB`, newest kept.
   *
   * Scoped to one job, so a frequent job can never evict a rare one's history -- a
   * global cap would let the 60-second heartbeats bury the monthly backup's rows.
   * The subquery is covered by `idx_scheduled_run_history_job`.
   */
  private pruneHistory(jobKey: string): void {
    this.db
      .prepare(
        `DELETE FROM sys_scheduled_run_history
          WHERE job_key = ?
            AND id NOT IN (
              SELECT id FROM sys_scheduled_run_history
               WHERE job_key = ?
               ORDER BY id DESC
               LIMIT ?
            )`,
      )
      .run(jobKey, jobKey, HISTORY_LIMIT_PER_JOB);
  }

  /**
   * Updates in place rather than upserting: `start` has always run first, so a
   * missing row means the job was never started and there is no run to describe.
   */
  finish(jobKey: string, status: ScheduledRunStatus, detail: string): void {
    this.db
      .prepare("UPDATE sys_scheduled_runs SET last_status = ?, last_detail = ? WHERE job_key = ?")
      .run(status, detail, jobKey);

    // Closes the newest OPEN pass for this job -- `finished_at IS NULL` rather than
    // just "the newest row". If a previous pass died mid-work its row stays open
    // forever, and matching on newest-only would eventually close that stale row
    // with this run's outcome, turning a crash into a success months later.
    this.db
      .prepare(
        `UPDATE sys_scheduled_run_history
            SET finished_at = datetime('now'), status = ?, detail = ?
          WHERE id = (
            SELECT id FROM sys_scheduled_run_history
             WHERE job_key = ? AND finished_at IS NULL
             ORDER BY id DESC
             LIMIT 1
          )`,
      )
      .run(status, detail, jobKey);
  }

  /**
   * This job's recorded passes, newest first.
   *
   * Ordered here, by `id` rather than by `started_at`: the id is monotonic, so two
   * passes stamped within the same second still come back in the order they
   * happened. `toHistoryViews` deliberately does not re-sort what this returns.
   */
  listHistory(jobKey: string, limit = HISTORY_LIMIT_PER_JOB): ScheduledRunHistoryEntry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM sys_scheduled_run_history
          WHERE job_key = ?
          ORDER BY id DESC
          LIMIT ?`,
      )
      .all(jobKey, limit) as ScheduledRunHistoryRow[];

    return rows.map((row) => ({
      id: row.id,
      jobKey: row.job_key,
      startedAt: row.started_at,
      finishedAt: row.finished_at ?? undefined,
      status: (row.status ?? undefined) as ScheduledRunStatus | undefined,
      detail: row.detail ?? undefined,
    }));
  }
}
