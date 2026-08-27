// The public surface of this module.
//
// NOTE ON IMPORTING THIS FROM A CLIENT COMPONENT: don't. This index re-exports
// `SqliteScheduledRunRepository` and the `deps`-backed runner, so pulling it into
// a `"use client"` file drags better-sqlite3 and `node:fs` into the browser
// bundle and the build fails with "the chunking context does not support external
// modules". Sibling modules (`next-day-actions`, `stock-dashboard`) avoid this by
// exporting no repository at all; this one has to, because the scheduler needs it.
//
// Client components import the types and the interval labels straight from
// `./types` instead -- see `admin/background-tasks/view.tsx`.

export type {
  RefreshInterval,
  ScheduledRefreshSettings,
  ScheduledRefreshSummary,
  ScheduledRun,
  ScheduledRunStatus,
} from "./types";
export { REFRESH_INTERVALS, REFRESH_INTERVAL_LABELS } from "./types";
export {
  refreshIntervalSchema,
  scheduledRefreshSettingsSchema,
  scheduledRunSchema,
  scheduledRunStatusSchema,
  type ScheduledRefreshSettingsInput,
} from "./schema";
// Both moved to `@/lib/scheduled-jobs`; re-exported for existing importers.
export type { ScheduledRunRepository } from "@/lib/scheduled-jobs/ports";
export { SqliteScheduledRunRepository } from "@/lib/scheduled-jobs/repository";
export {
  DEFAULT_REFRESH_INTERVAL,
  SCHEDULED_REFRESH_SETTING_KEYS,
  STOCK_AUTO_REFRESH_JOB_KEY,
  STOCK_ETFS_MODULE_SLUG,
  intervalToMinutes,
  isAutoRefreshEnabled,
  nextRunDueAtMs,
  resolveScheduledRefreshSettings,
  scheduledRefreshSettingsToEntries,
  shouldRunNow,
} from "./settings";
export {
  runScheduledRefresh,
  type ScheduledRefreshDeps,
} from "./scheduled-refresh";
export {
  loadLastScheduledRun,
  loadScheduledRefreshSettings,
  runScheduledRefreshNow,
} from "./refresh-runner";
