// An OPERATIONAL log line every time a background job starts or finishes.
//
// ## Why this is a decorator and not an edit to each runner
//
// There are seven jobs, each with its own runner and its own timer in
// `src/instrumentation-node.ts`. Adding two log calls to each would be fourteen
// edits, and an eighth job added next month would silently log nothing — the same
// trap `ScheduledRunRepository` already solved for run history, which the SQLite
// repository derives from `start`/`finish` precisely so a new runner cannot forget
// to record itself (see migrations/0135).
//
// So this wraps that port instead. Every job already calls `start` before its work
// and `finish` after it, so wrapping the repository once in `wiring.ts` instruments
// all seven — and the eighth — with no runner changes at all.
//
// ## What it costs when the switch is off
//
// Nothing beyond a method call and a boolean test: the logger caches its settings,
// and every message here is built inside a thunk, so the job label is not even
// looked up unless a line is actually being written. See `lib/system-log/logger.ts`.
//
// ## What it does NOT do
//
// It does not log DEBUG lines, and it does not change what is written to
// `sys_scheduled_runs` or `sys_scheduled_run_history`. The run tables stay the
// record of how a pass went; this is the running commentary beside them.

import type { SystemLogger } from "@/lib/system-log";

import type { ScheduledRunRepository } from "./ports";
import { JOB_DESCRIPTORS } from "./types";
import type { ScheduledRun, ScheduledRunHistoryEntry, ScheduledRunStatus } from "./types";

/** The source every line from this file carries. */
export const SCHEDULED_JOBS_LOG_SOURCE = "scheduled-jobs";

/**
 * A job's label as the Background Tasks screen shows it, or its raw key.
 *
 * Reads from the catalogue rather than the key so a line says `Investments auto
 * refresh` and not `stock_auto_refresh` — the log is read by a person, and the key
 * is an implementation detail they would have to translate.
 *
 * Falls back to the key for a job with no descriptor. That is a real case: a retired
 * job's rows outlive its catalogue entry, and a log line naming an unknown key is
 * more useful than one naming nothing.
 */
export function describeJobKey(jobKey: string): string {
  return JOB_DESCRIPTORS.find((descriptor) => descriptor.key === jobKey)?.label ?? jobKey;
}

/**
 * Wraps a run repository so every start and finish writes an OPERATIONAL line.
 *
 * Delegates everything, adds nothing to the stored rows. The wrapped repository is
 * the one source of truth; this only watches it.
 */
export function withSystemLog(
  inner: ScheduledRunRepository,
  logger: SystemLogger,
): ScheduledRunRepository {
  return {
    get: (jobKey: string): ScheduledRun | undefined => inner.get(jobKey),

    list: (): ScheduledRun[] => inner.list(),

    listHistory: (jobKey: string, limit?: number): ScheduledRunHistoryEntry[] =>
      inner.listHistory(jobKey, limit),

    start(jobKey: string, startedAt: string): void {
      // The write first, then the line. If logging somehow became expensive, the
      // job's own bookkeeping should not wait on it — and a crash between the two
      // leaves the run recorded, which is the half that matters.
      inner.start(jobKey, startedAt);
      logger.operational(
        SCHEDULED_JOBS_LOG_SOURCE,
        () => `Job "${describeJobKey(jobKey)}" triggered.`,
      );
    },

    finish(jobKey: string, status: ScheduledRunStatus, detail: string): void {
      inner.finish(jobKey, status, detail);
      logger.operational(SCHEDULED_JOBS_LOG_SOURCE, () => {
        const label = describeJobKey(jobKey);
        // `detail` is the same one-liner the admin card shows ("38 priced, 1
        // failed"), so the log and the screen say the same thing about a pass.
        const suffix = detail.trim() === "" ? "" : ` — ${detail.trim()}`;
        return `Job "${label}" finished: ${status}${suffix}`;
      });
    },
  };
}
