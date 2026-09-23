// Resolves the prune's dependencies from the composition root, decides whether a
// pass is due, and records it in `sys_scheduled_runs`.
//
// Separate from site-visits.ts so that file stays pure functions over a repository,
// while this one knows about `deps`, the clock and the last-run table -- the same
// split, and the same reasons, as src/lib/auth-events/prune-runner.ts.

import { JOB_KEYS, type ScheduledRun } from "@/lib/scheduled-jobs";
import { toSqliteTimestampUtc } from "@/lib/shared/date";
import { deps } from "@/lib/wiring";
import { DEFAULT_RETENTION_DAYS, pruneSiteVisits } from "./site-visits";

export const SITE_VISIT_PRUNE_JOB_KEY = JOB_KEYS.siteVisitPrune;

/** How often a pass may run. A day, matching the sign-in history prune. */
export const PRUNE_INTERVAL_MINUTES = 24 * 60;

/** What one prune pass did. `ran: false` means it was skipped, not that it failed. */
export interface SiteVisitPruneSummary {
  ran: boolean;
  /** Why it was skipped. Only set when `ran` is false. */
  reason?: string;
  deletedCount: number;
  /** The one-line summary stored as `detail` and shown on the admin screen. */
  detail: string;
}

/** The stored record of the last prune, for the Background Tasks screen. */
export function loadLastPruneRun(): ScheduledRun | undefined {
  return deps.scheduledRunRepo.get(SITE_VISIT_PRUNE_JOB_KEY);
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
 * than waiting a day to start, matching every other job.
 */
export function shouldPruneNow(lastRunAtMs: number | undefined, nowMs: number): boolean {
  if (lastRunAtMs === undefined) return true;
  return nowMs - lastRunAtMs >= PRUNE_INTERVAL_MINUTES * 60_000;
}

/**
 * Runs one prune pass if it is due, recording it in `sys_scheduled_runs`.
 * Never throws -- a scheduled job must not take the server down.
 *
 * No `force` option, for the reason the sign-in prune gives: a pass *deletes*
 * history past the retention window, and there is nothing to inspect afterwards, so
 * there is no diagnostic reason to trigger one by hand. `JOB_DESCRIPTORS` marks it
 * `runnable: false` and the Background Tasks screen offers no button.
 */
export function runSiteVisitPruneNow(): SiteVisitPruneSummary {
  try {
    if (!shouldPruneNow(lastRunAtMs(loadLastPruneRun()), Date.now())) {
      return { ran: false, reason: "Not due yet.", deletedCount: 0, detail: "not due yet" };
    }

    // Stamped before the work, so a slow pass cannot overlap the next tick.
    deps.scheduledRunRepo.start(SITE_VISIT_PRUNE_JOB_KEY, toSqliteTimestampUtc(new Date()));

    const deletedCount = pruneSiteVisits(deps.siteVisitRepo, DEFAULT_RETENTION_DAYS);
    // "0 deleted" is the healthy steady state for a 90-day window, and recording it
    // is the point: it proves the job ran, which a silent log cannot.
    const detail = `${deletedCount} visit(s) deleted, ${DEFAULT_RETENTION_DAYS}-day retention`;
    deps.scheduledRunRepo.finish(SITE_VISIT_PRUNE_JOB_KEY, "ok", detail);

    return { ran: true, deletedCount, detail };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown prune error.";
    // Best-effort: if the throw came from the database this fails too.
    try {
      deps.scheduledRunRepo.finish(SITE_VISIT_PRUNE_JOB_KEY, "failed", detail);
    } catch {
      // Deliberately ignored.
    }
    return { ran: false, reason: detail, deletedCount: 0, detail };
  }
}
