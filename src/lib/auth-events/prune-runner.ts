// Resolves the prune's dependencies from the composition root, decides whether a
// pass is due, and records it in `sys_scheduled_runs`.
//
// Separate from auth-events.ts so that file stays pure functions over a repository,
// while this one knows about `deps`, the clock and the last-run table -- the same
// split, and the same reasons, as src/lib/expense/auto-import-runner.ts and
// src/lib/scheduled-refresh/refresh-runner.ts.

import { JOB_KEYS, type ScheduledRun } from "@/lib/scheduled-jobs";
import { toSqliteTimestampUtc } from "@/lib/shared/date";
import { deps } from "@/lib/wiring";
import { DEFAULT_RETENTION_DAYS, pruneAuthEvents } from "./auth-events";

export const AUTH_EVENT_PRUNE_JOB_KEY = JOB_KEYS.authEventPrune;

/**
 * How often a pass may run. A day, matching the timer in `instrumentation-node.ts`.
 *
 * This constant is why the job no longer prunes on every boot: the startup pass
 * asks whether a day has actually elapsed since the stored stamp, rather than
 * assuming a restart means a new day. `start.sh` restarts the process after any
 * crash and on every deploy, so on a busy day the old behaviour ran this many
 * times over -- harmless for a 90-day window, but it made the last-run timestamp
 * useless as a signal that anything was working.
 */
export const PRUNE_INTERVAL_MINUTES = 24 * 60;

/** What one prune pass did. `ran: false` means it was skipped, not that it failed. */
export interface AuthEventPruneSummary {
  ran: boolean;
  /** Why it was skipped. Only set when `ran` is false. */
  reason?: string;
  deletedCount: number;
  /** The one-line summary stored as `detail` and shown on the admin screen. */
  detail: string;
}

/** The stored record of the last prune, for the Background Tasks screen. */
export function loadLastPruneRun(): ScheduledRun | undefined {
  return deps.scheduledRunRepo.get(AUTH_EVENT_PRUNE_JOB_KEY);
}

/**
 * A stored `last_run_at` as epoch millis, or `undefined` if the job has never run.
 * The trailing "Z" is load-bearing -- see the same helper in `refresh-runner.ts`.
 */
function lastRunAtMs(run: ScheduledRun | undefined): number | undefined {
  if (!run) return undefined;
  const parsed = Date.parse(`${run.lastRunAt.replace(" ", "T")}Z`);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Whether enough time has passed to prune again. Pure and exported so the interval
 * decision is testable without waiting a day.
 *
 * Never having run returns true: a fresh install prunes on its first pass rather
 * than waiting a day to start, which matches both other jobs.
 */
export function shouldPruneNow(lastRunAtMs: number | undefined, nowMs: number): boolean {
  if (lastRunAtMs === undefined) return true;
  return nowMs - lastRunAtMs >= PRUNE_INTERVAL_MINUTES * 60_000;
}

/**
 * Runs one prune pass if it is due, recording it in `sys_scheduled_runs`.
 * Never throws -- a scheduled job must not take the server down.
 *
 * There is deliberately no `force` option, unlike the other two runners. A pass
 * *deletes* sign-in history past the retention window, and unlike an import or a
 * price refresh there is nothing to inspect afterwards, so there is no diagnostic
 * reason to trigger one by hand. The Background Tasks screen shows this job's last
 * run and offers no button; `JOB_DESCRIPTORS` marks it `runnable: false`.
 */
export function runAuthEventPruneNow(): AuthEventPruneSummary {
  try {
    if (!shouldPruneNow(lastRunAtMs(loadLastPruneRun()), Date.now())) {
      return { ran: false, reason: "Not due yet.", deletedCount: 0, detail: "not due yet" };
    }

    // Stamped before the work, so a slow pass cannot overlap the next tick.
    deps.scheduledRunRepo.start(AUTH_EVENT_PRUNE_JOB_KEY, toSqliteTimestampUtc(new Date()));

    const deletedCount = pruneAuthEvents(deps.authEventRepo, DEFAULT_RETENTION_DAYS);
    // "0 deleted" is the healthy steady state for a 90-day window, and recording it
    // is the point: it proves the job ran, which a silent log cannot.
    const detail = `${deletedCount} event(s) deleted, ${DEFAULT_RETENTION_DAYS}-day retention`;
    deps.scheduledRunRepo.finish(AUTH_EVENT_PRUNE_JOB_KEY, "ok", detail);

    return { ran: true, deletedCount, detail };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown prune error.";
    // Best-effort: if the throw came from the database this fails too.
    try {
      deps.scheduledRunRepo.finish(AUTH_EVENT_PRUNE_JOB_KEY, "failed", detail);
    } catch {
      // Deliberately ignored.
    }
    return { ran: false, reason: detail, deletedCount: 0, detail };
  }
}
