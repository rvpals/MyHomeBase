// The public surface of this module.
//
// NOTE ON IMPORTING THIS FROM A CLIENT COMPONENT: don't. This index re-exports
// `SqliteScheduledRunRepository`, so pulling it into a `"use client"` file drags
// better-sqlite3 into the browser bundle and the build fails. Client components
// import the types straight from `./types` -- same rule, and the same reason, as
// `src/lib/scheduled-refresh/index.ts`.

export type {
  ActiveTaskRow,
  InactiveTaskRow,
  JobDescriptor,
  JobKey,
  NextRun,
  ScheduledJobView,
  ScheduledRun,
  ScheduledRunHistoryEntry,
  ScheduledRunHistoryView,
  ScheduledRunStatus,
} from "./types";
export { HISTORY_LIMIT_PER_JOB, JOB_DESCRIPTORS, JOB_KEYS } from "./types";
export {
  describeDuration,
  describeHistoryEntry,
  durationMsOf,
  toHistoryViews,
} from "./history";
export { scheduledRunSchema, scheduledRunStatusSchema } from "./schema";
export type { ScheduledRunRepository } from "./ports";
export { SqliteScheduledRunRepository } from "./repository";
export { describeLastRun, listScheduledJobs } from "./jobs";
export type { ActiveTaskInputs, JobSettings } from "./active-tasks";
export { isJobArmed, listActiveTasks, listInactiveTasks } from "./active-tasks";
