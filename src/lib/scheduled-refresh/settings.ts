// Pure settings resolution and the scheduling decision. No I/O, no timers, no
// `deps` -- which is what makes the "is it time yet?" question testable without
// waiting for a clock. `refresh-runner.ts` is the half that knows about the
// composition root.
//
// Modelled on src/lib/expense/settings.ts, the app's other scheduled job.

import type { ModuleSetting } from "@/lib/module-settings";
import { JOB_KEYS } from "@/lib/scheduled-jobs/types";
import { refreshIntervalSchema } from "./schema";
import type { RefreshInterval, ScheduledRefreshSettings } from "./types";

/** The module whose settings drive this job, and the job's row in `sys_scheduled_runs`. */
export const STOCK_ETFS_MODULE_SLUG = "stock-etfs";
// Aliased from the job catalogue rather than spelled again -- one literal for the
// string that is also a primary key in `sys_scheduled_runs`.
export const STOCK_AUTO_REFRESH_JOB_KEY = JOB_KEYS.stockAutoRefresh;

export const SCHEDULED_REFRESH_SETTING_KEYS = {
  autoRefreshEnabled: "auto_refresh_enabled",
  autoRefreshInterval: "auto_refresh_interval",
} as const;

export const DEFAULT_REFRESH_INTERVAL: RefreshInterval = "daily";

const INTERVAL_MINUTES: Record<RefreshInterval, number> = {
  hourly: 60,
  "half-daily": 12 * 60,
  daily: 24 * 60,
};

/** How many minutes an interval means. The only place these numbers exist. */
export function intervalToMinutes(interval: RefreshInterval): number {
  return INTERVAL_MINUTES[interval];
}

/**
 * Parses the module's settings rows into typed values.
 *
 * A missing or unrecognised switch reads as **off**, and a missing or
 * unrecognised interval falls back to `daily`. Both directions are deliberate:
 * an install where the seed didn't land (the module was removed, say) stays
 * disabled rather than erroring, and a hand-edited `auto_refresh_interval` of
 * "every 7 minutes" degrades to the safe cadence instead of throwing inside a
 * background tick where nobody would see it.
 *
 * Note this is the opposite default from the expense importer, whose absent
 * switch means *on* -- that one was retrofitted over installs already importing.
 * See migrations/0061.
 */
export function resolveScheduledRefreshSettings(
  settings: ModuleSetting[],
): ScheduledRefreshSettings {
  const byKey = new Map(settings.map((setting) => [setting.key, setting.value]));

  const rawEnabled = byKey.get(SCHEDULED_REFRESH_SETTING_KEYS.autoRefreshEnabled);
  const autoRefreshEnabled = rawEnabled?.trim().toLowerCase() === "true";

  const parsedInterval = refreshIntervalSchema.safeParse(
    byKey.get(SCHEDULED_REFRESH_SETTING_KEYS.autoRefreshInterval)?.trim(),
  );

  return {
    autoRefreshEnabled,
    autoRefreshInterval: parsedInterval.success ? parsedInterval.data : DEFAULT_REFRESH_INTERVAL,
  };
}

/**
 * Serializes settings back into module-setting entries.
 *
 * Both keys are always written, including the interval when the switch is off:
 * the dropdown stays populated with the user's last choice so turning the switch
 * back on doesn't silently reset the cadence to `daily`.
 */
export function scheduledRefreshSettingsToEntries(
  settings: ScheduledRefreshSettings,
): { key: string; value: string }[] {
  return [
    {
      key: SCHEDULED_REFRESH_SETTING_KEYS.autoRefreshEnabled,
      value: settings.autoRefreshEnabled ? "true" : "false",
    },
    {
      key: SCHEDULED_REFRESH_SETTING_KEYS.autoRefreshInterval,
      value: settings.autoRefreshInterval,
    },
  ];
}

/**
 * Whether enough time has passed to run again.
 *
 * Kept separate and pure so the scheduling decision is testable without timers:
 * the runner ticks on a short fixed heartbeat and asks this, which is what lets an
 * interval change take effect without restarting the server.
 *
 * `lastRunAtMs === undefined` means "never run" and returns true, so a fresh
 * install refreshes on its first tick rather than waiting a full day to start.
 */
export function shouldRunNow(
  lastRunAtMs: number | undefined,
  interval: RefreshInterval,
  nowMs: number,
): boolean {
  if (lastRunAtMs === undefined) return true;
  return nowMs - lastRunAtMs >= intervalToMinutes(interval) * 60_000;
}

/** True when the background job should run: switched on. */
export function isAutoRefreshEnabled(settings: ScheduledRefreshSettings): boolean {
  return settings.autoRefreshEnabled;
}

/**
 * When the next run is due, given the last one. `undefined` when the job is off
 * or has never run -- there is no meaningful "next" in either case.
 */
export function nextRunDueAtMs(
  lastRunAtMs: number | undefined,
  settings: ScheduledRefreshSettings,
): number | undefined {
  if (!settings.autoRefreshEnabled || lastRunAtMs === undefined) return undefined;
  return lastRunAtMs + intervalToMinutes(settings.autoRefreshInterval) * 60_000;
}
