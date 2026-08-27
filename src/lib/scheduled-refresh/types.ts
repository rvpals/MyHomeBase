// Domain models for the scheduled refresh: the interval the user picks, the
// resolved settings, the last-run record, and what one pass reports.

/**
 * Every interval, in the order the settings dropdown lists them.
 *
 * A closed set rather than a number of minutes (see migrations/0061): the UI
 * offers exactly three choices, so nothing else should be representable. Declared
 * as the tuple and the type derived from it -- same shape as
 * `ATTENDANCE_STATUSES` -- so `z.enum` can consume it directly and the list stays
 * the single source of truth.
 */
export const REFRESH_INTERVALS = ["hourly", "half-daily", "daily"] as const;

/** How often the background refresh runs. */
export type RefreshInterval = (typeof REFRESH_INTERVALS)[number];

/** How each interval is written in the UI. Presentation reads this; it never invents labels. */
export const REFRESH_INTERVAL_LABELS: Record<RefreshInterval, string> = {
  hourly: "Every hour",
  "half-daily": "Every half day",
  daily: "Every day",
};

export interface ScheduledRefreshSettings {
  /**
   * Master switch. Off means the server never refreshes on its own, whatever the
   * interval says. It does not gate the manual Refresh All button, which is an
   * explicit request rather than a background job.
   */
  autoRefreshEnabled: boolean;
  /** How often to run when the switch is on. */
  autoRefreshInterval: RefreshInterval;
}

// The run record and its status live in `@/lib/scheduled-jobs` now -- three jobs
// share that bookkeeping, so it is no longer a stocks concern. Re-exported here so
// existing importers keep resolving.
export type { ScheduledRun, ScheduledRunStatus } from "@/lib/scheduled-jobs/types";
import type { ScheduledRunStatus } from "@/lib/scheduled-jobs/types";

/** What one refresh pass did. Returned by the runner and rendered by both front-ends. */
export interface ScheduledRefreshSummary {
  /** False when the pass was skipped — switched off, not yet due, or nothing to price. */
  ran: boolean;
  /** Why it was skipped. Only set when `ran` is false. */
  reason?: string;
  status?: ScheduledRunStatus;
  pricedCount: number;
  failedCount: number;
  /** Sectors looked up. Usually 0 — a ticker's sector is cached for 90 days. */
  sectorsFetchedCount: number;
  /** True once today's snapshot has been filed. */
  snapshotSaved: boolean;
  /** The one-line summary stored as `detail` and shown in the UI. */
  detail: string;
}
