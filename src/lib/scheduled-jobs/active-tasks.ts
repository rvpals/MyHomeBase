// The use-case behind the Background Tasks screen's "Active Tasks" card: of the
// four jobs in the catalogue, which are actually armed right now, and when does
// each run next.
//
// Pure -- takes data, returns data. The settings arrive as already-resolved
// objects from the two modules that own the switches, so this file never reads a
// settings row or touches a clock of its own: `nowMs` is a parameter, which is
// what makes every case below testable without waiting.
//
// Why "armed" is not the same as "switched on": the expense importer needs a
// switch *and* a folder *and* a positive interval (`isAutoImportEnabled`), so a
// job switched on with a blank folder is not running and must not be listed as
// an active task. Listing it would recreate exactly the confusion the screen's
// header comment says the per-job cards exist to prevent -- a job that looks
// armed while nothing happens, with no visible reason why.

import {
  isBackupEnabled,
  nextRunDueAtMs as backupNextRunDueAtMs,
} from "@/lib/backup/settings";
import type { BackupSettings } from "@/lib/backup/types";
import {
  isHelloWorldEnabled,
  nextRunDueAtMs as helloWorldNextRunDueAtMs,
} from "@/lib/hello-world/settings";
import type { HelloWorldSettings } from "@/lib/hello-world/types";
import {
  isAutoImportEnabled,
  nextRunDueAtMs as expenseNextRunDueAtMs,
  type ExpenseSettings,
} from "@/lib/expense/settings";
import {
  isAutoRefreshEnabled,
  nextRunDueAtMs as stockNextRunDueAtMs,
} from "@/lib/scheduled-refresh/settings";
import type { ScheduledRefreshSettings } from "@/lib/scheduled-refresh/types";
import {
  JOB_KEYS,
  type ActiveTaskRow,
  type InactiveTaskRow,
  type NextRun,
  type ScheduledJobView,
  type ScheduledRunStatus,
} from "./types";

/**
 * The prunes' fixed cadence, mirroring `PRUNE_INTERVAL_MS` in
 * `src/instrumentation-node.ts`. Duplicated rather than imported because that
 * file is the composition root for the timers and pulling it in here would drag
 * better-sqlite3 into anything that imports this use-case.
 */
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** The two jobs with no switch: armed whenever the server is up. */
const ALWAYS_ARMED = new Set<string>([JOB_KEYS.authEventPrune, JOB_KEYS.siteVisitPrune]);

/**
 * Parses a stored stamp into epoch ms.
 *
 * `sys_scheduled_runs.last_run_at` holds a SQLite-style UTC timestamp
 * (`YYYY-MM-DD HH:MM:SS`), which `Date.parse` treats as *local* time in some
 * engines and UTC in others. The space is replaced with `T` and a `Z` appended so
 * it is unambiguously UTC everywhere -- without this the next-run time drifts by
 * the host's offset, which on a machine running in US Eastern is five hours.
 */
function parseStampMs(stamp: string): number | undefined {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(stamp.trim())
    ? `${stamp.trim().replace(" ", "T")}Z`
    : stamp.trim();
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? undefined : ms;
}

/** The outcome shown for a job, distinguishing "never ran" from "died mid-pass". */
function resolveStatus(
  hasRun: boolean,
  status: ScheduledRunStatus | undefined,
): ActiveTaskRow["status"] {
  if (!hasRun) return "never";
  // A stored run with no status means the process died between the start stamp
  // and the finish write. Reporting that honestly is the reason the column is
  // nullable -- claiming "ok" would be the worst possible lie on this screen.
  return status ?? "interrupted";
}

/**
 * The next run for a job whose cadence is a real interval.
 *
 * `dueAtMs` is whatever the owning module's `nextRunDueAtMs` returned, so this
 * function never re-derives a cadence it doesn't own.
 */
function intervalNextRun(hasRun: boolean, dueAtMs: number | undefined): NextRun {
  if (!hasRun) return { kind: "pending" };
  return dueAtMs === undefined ? { kind: "pending" } : { kind: "at", atMs: dueAtMs };
}

/**
 * The next run for the two prunes.
 *
 * Deliberately a window and not a time -- see the `NextRun` doc. A prune that has
 * never run is pending: the startup pass fires 30-45s after boot.
 */
function pruneNextRun(lastRunAtMs: number | undefined): NextRun {
  if (lastRunAtMs === undefined) return { kind: "pending" };
  return { kind: "within", windowMs: PRUNE_INTERVAL_MS, fromMs: lastRunAtMs };
}

export interface ActiveTaskInputs {
  /** Every job joined against its stored run, from `listScheduledJobs`. */
  jobs: ScheduledJobView[];
  autoRefresh: ScheduledRefreshSettings;
  expense: ExpenseSettings;
  backup: BackupSettings;
  helloWorld: HelloWorldSettings;
  /** Injected so the never-run backup's anchor time is testable without a clock. */
  nowMs?: number;
}

/**
 * Every job's settings in one bag, so the predicates below take one argument
 * instead of a growing row of positional ones.
 *
 * It became an object at the fifth job. Four settings objects in a fixed order was
 * already a signature where swapping two arguments type-checks whenever the two
 * share a shape, and each new job made that worse -- naming them removes the class
 * of mistake entirely.
 */
export interface JobSettings {
  autoRefresh: ScheduledRefreshSettings;
  expense: ExpenseSettings;
  backup: BackupSettings;
  helloWorld: HelloWorldSettings;
}

/**
 * Whether a given job is armed right now.
 *
 * Exported for the test and for anything that needs the predicate without the
 * whole row. A job key with no case here is treated as not armed, so adding a
 * sixth job to the catalogue without teaching this function about it omits it
 * from the card rather than claiming it is running.
 */
export function isJobArmed(key: string, settings: JobSettings): boolean {
  if (ALWAYS_ARMED.has(key)) return true;
  if (key === JOB_KEYS.stockAutoRefresh) return isAutoRefreshEnabled(settings.autoRefresh);
  if (key === JOB_KEYS.expenseAutoImport) return isAutoImportEnabled(settings.expense);
  // Switched on AND both folders set: a backup with no destination is misconfigured,
  // not armed, which is the same rule the expense importer applies to its folder.
  if (key === JOB_KEYS.dataBackup) return isBackupEnabled(settings.backup);
  // Just the switch: this job has no folder and no external precondition, so there
  // is nothing that could be switched on and still unable to run.
  if (key === JOB_KEYS.helloWorld) return isHelloWorldEnabled(settings.helloWorld);
  return false;
}

/**
 * The armed jobs, in catalogue order, as the Active Tasks card renders them.
 *
 * Driven by the job views rather than by the settings, so the card can never list
 * a job that isn't in the catalogue. An unarmed job yields no row at all.
 */
export function listActiveTasks({
  jobs,
  autoRefresh,
  expense,
  backup,
  helloWorld,
  nowMs = Date.now(),
}: ActiveTaskInputs): ActiveTaskRow[] {
  const rows: ActiveTaskRow[] = [];
  const settings: JobSettings = { autoRefresh, expense, backup, helloWorld };

  for (const { descriptor, lastRun } of jobs) {
    if (!isJobArmed(descriptor.key, settings)) continue;

    const hasRun = lastRun !== undefined;
    const lastRunAtMs = lastRun ? parseStampMs(lastRun.lastRunAt) : undefined;

    // Every job gets an explicit branch. A new job added to the catalogue without
    // one would silently inherit whichever cadence the final `else` happens to use,
    // so there is no catch-all here by design.
    let nextRun: NextRun;
    if (ALWAYS_ARMED.has(descriptor.key)) {
      nextRun = pruneNextRun(lastRunAtMs);
    } else if (descriptor.key === JOB_KEYS.stockAutoRefresh) {
      nextRun = intervalNextRun(hasRun, stockNextRunDueAtMs(lastRunAtMs, autoRefresh));
    } else if (descriptor.key === JOB_KEYS.expenseAutoImport) {
      nextRun = intervalNextRun(hasRun, expenseNextRunDueAtMs(lastRunAtMs, expense));
    } else if (descriptor.key === JOB_KEYS.helloWorld) {
      nextRun = intervalNextRun(hasRun, helloWorldNextRunDueAtMs(lastRunAtMs, helloWorld));
    } else {
      // The backup job knows its own anchor time, so unlike the others a never-run
      // backup still has a real "next run" — the next time its start time comes round.
      const dueAt = backupNextRunDueAtMs(lastRunAtMs, backup, nowMs);
      nextRun = dueAt === undefined ? { kind: "pending" } : { kind: "at", atMs: dueAt };
    }

    rows.push({
      key: descriptor.key,
      label: descriptor.label,
      nextRun,
      lastRunAt: lastRun?.lastRunAt,
      status: resolveStatus(hasRun, lastRun?.status),
      detail: lastRun?.detail,
    });
  }

  return rows;
}

/**
 * Why a job is not armed, as one sentence naming the fix.
 *
 * "Switched off" and "switched on but missing a folder" need different actions from
 * the reader, so the Inactive tab says which one applies rather than just "inactive".
 * The expense and backup cases check the configuration FIRST: a job that is both
 * switched off and unconfigured has two problems, and turning the switch on would
 * not start it -- so naming the switch alone would send the reader in a circle.
 */
function inactiveReason(
  key: string,
  { autoRefresh, expense, backup }: JobSettings,
): string {
  if (key === JOB_KEYS.helloWorld) {
    // The only possible reason: there is no folder or other precondition to miss.
    return "Switched off. Turn on “Run on a schedule” to arm it.";
  }

  if (key === JOB_KEYS.stockAutoRefresh) {
    return autoRefresh.autoRefreshEnabled
      ? "Switched on but not running — check the Investments auto refresh card."
      : "Switched off. Turn on “Run on a schedule” to arm it.";
  }

  if (key === JOB_KEYS.expenseAutoImport) {
    if (expense.autoImportPath === "") return "No watched folder is set.";
    if (expense.autoImportIntervalMinutes <= 0) return "The interval is 0, so it never runs.";
    return "Switched off. Turn on “Run on a schedule” to arm it.";
  }

  if (key === JOB_KEYS.dataBackup) {
    if (backup.attachmentRoot === "" && backup.databaseRoot === "") {
      return "Neither backup folder is set.";
    }
    if (backup.attachmentRoot === "") return "No attachment backup folder is set.";
    if (backup.documentRoot === "") return "No document backup folder is set.";
    if (backup.databaseRoot === "") return "No database backup folder is set.";
    return "Switched off. Turn on “Run on a schedule” to arm it.";
  }

  // The two prunes can never reach here -- they are in ALWAYS_ARMED. A job key with
  // no case above lands here too, which is the honest answer for one this function
  // has not been taught about.
  return "Not armed.";
}

/**
 * The jobs that are NOT currently armed, in catalogue order.
 *
 * The exact complement of `listActiveTasks`, decided by the same `isJobArmed` call,
 * so every job appears in exactly one of the two tabs -- never both, never neither.
 * That is the property worth protecting here: two independent predicates would
 * eventually disagree and a job would silently vanish from the screen.
 */
export function listInactiveTasks({
  jobs,
  autoRefresh,
  expense,
  backup,
  helloWorld,
}: ActiveTaskInputs): InactiveTaskRow[] {
  const rows: InactiveTaskRow[] = [];
  const settings: JobSettings = { autoRefresh, expense, backup, helloWorld };

  for (const { descriptor, lastRun } of jobs) {
    if (isJobArmed(descriptor.key, settings)) continue;

    rows.push({
      key: descriptor.key,
      label: descriptor.label,
      reason: inactiveReason(descriptor.key, settings),
      lastRunAt: lastRun?.lastRunAt,
      status: resolveStatus(lastRun !== undefined, lastRun?.status),
      detail: lastRun?.detail,
    });
  }

  return rows;
}
