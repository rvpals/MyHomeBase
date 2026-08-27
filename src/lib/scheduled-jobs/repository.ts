import type Database from "better-sqlite3";
import { scheduledRunSchema } from "./schema";
import type { ScheduledRunRepository } from "./ports";
import type { ScheduledRun, ScheduledRunStatus } from "./types";

interface ScheduledRunRow {
  job_key: string;
  last_run_at: string;
  last_status: string | null;
  last_detail: string | null;
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
  }

  /**
   * Updates in place rather than upserting: `start` has always run first, so a
   * missing row means the job was never started and there is no run to describe.
   */
  finish(jobKey: string, status: ScheduledRunStatus, detail: string): void {
    this.db
      .prepare("UPDATE sys_scheduled_runs SET last_status = ?, last_detail = ? WHERE job_key = ?")
      .run(status, detail, jobKey);
  }
}
