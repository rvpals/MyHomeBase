// The use-case behind Administration -> Background Tasks: what jobs exist, and
// what the table says about each one's last run.
//
// Pure -- takes data, returns data. The whole point is answering the question the
// app previously could only answer by reading `app.log` on the NAS: did this job
// actually run?

import { JOB_DESCRIPTORS, type ScheduledJobView, type ScheduledRun } from "./types";

/**
 * Every known job, in catalogue order, joined against its stored run.
 *
 * Driven by `JOB_DESCRIPTORS` rather than by the table's rows, which is the
 * important direction: a job that has never run has no row, and listing the table
 * would silently omit it -- leaving the screen unable to distinguish "never ran"
 * from "doesn't exist". Every descriptor always yields exactly one entry.
 *
 * A row with no matching descriptor is ignored: a job key retired in code
 * shouldn't resurrect itself on the screen because an old row lingers.
 */
export function listScheduledJobs(runs: ScheduledRun[]): ScheduledJobView[] {
  const byKey = new Map(runs.map((run) => [run.jobKey, run]));
  return JOB_DESCRIPTORS.map((descriptor) => ({
    descriptor,
    lastRun: byKey.get(descriptor.key),
  }));
}

/** How a job's last run reads on one line. The web and the CLI share this wording. */
export function describeLastRun(view: ScheduledJobView): string {
  const run = view.lastRun;
  if (!run) return "Never run.";

  // No status with a timestamp present means the process died between `start` and
  // `finish` -- reporting that honestly is the reason the column is nullable.
  const outcome = run.status ?? "interrupted";
  const detail = run.detail ? ` (${run.detail})` : "";
  return `Last run ${run.lastRunAt} — ${outcome}${detail}.`;
}
