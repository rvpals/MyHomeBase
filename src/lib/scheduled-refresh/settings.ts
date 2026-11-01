// Pure settings resolution and the scheduling decision. No I/O, no timers, no
// `deps` -- which is what makes the "is it time yet?" question testable without
// waiting for a clock. `refresh-runner.ts` is the half that knows about the
// composition root.
//
// Modelled on src/lib/expense/settings.ts, the app's other scheduled job.

import type { ModuleSetting } from "@/lib/module-settings";
import { isMarketDay, nextMarketDay } from "@/lib/market-calendar";
import { JOB_KEYS } from "@/lib/scheduled-jobs/types";
import { toIsoDateLocal } from "@/lib/shared/date";
import { refreshIntervalSchema } from "./schema";
import type { RefreshInterval, ScheduledRefreshSettings } from "./types";

/** The module whose settings drive this job, and the job's row in `sys_scheduled_runs`. */
export const INVESTMENTS_MODULE_SLUG = "investments";
// Aliased from the job catalogue rather than spelled again -- one literal for the
// string that is also a primary key in `sys_scheduled_runs`.
export const STOCK_AUTO_REFRESH_JOB_KEY = JOB_KEYS.stockAutoRefresh;

export const SCHEDULED_REFRESH_SETTING_KEYS = {
  autoRefreshEnabled: "auto_refresh_enabled",
  autoRefreshInterval: "auto_refresh_interval",
  marketDaysOnly: "market_days_only",
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
 *
 * `market_days_only` is the one key here that defaults to **on**: only an
 * explicit "false" disables it. There is no migration seeding the key, so an
 * install that predates it has no row -- and refreshing prices on a day the
 * market never opened only rewrites yesterday's close over itself. Absent
 * therefore means "skip closed days", which is both the useful behaviour and
 * the one that needs no backfill. A user who wants weekend passes unticks the
 * box, which writes "false" and sticks.
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

  // Only an explicit "false" turns this off -- absent, blank or unrecognised all
  // read as on. See the note above.
  const rawMarketDaysOnly = byKey.get(SCHEDULED_REFRESH_SETTING_KEYS.marketDaysOnly);
  const marketDaysOnly = rawMarketDaysOnly?.trim().toLowerCase() !== "false";

  return {
    autoRefreshEnabled,
    autoRefreshInterval: parsedInterval.success ? parsedInterval.data : DEFAULT_REFRESH_INTERVAL,
    marketDaysOnly,
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
    {
      key: SCHEDULED_REFRESH_SETTING_KEYS.marketDaysOnly,
      value: settings.marketDaysOnly ? "true" : "false",
    },
  ];
}

/**
 * Whether enough time has passed to run again, and whether today is a day worth
 * running on.
 *
 * Kept separate and pure so the scheduling decision is testable without timers:
 * the runner ticks on a short fixed heartbeat and asks this, which is what lets an
 * interval change take effect without restarting the server.
 *
 * `lastRunAtMs === undefined` means "never run" and passes the interval test, so a
 * fresh install refreshes on its first tick rather than waiting a full day to
 * start -- but it still has to be a market day. A never-run install that first
 * boots on a Sunday waits until Monday, which is the point.
 *
 * `marketIsoDate` is today in the **market's** timezone, not the server's --
 * `MARKET_TIME_ZONE`. The caller resolves it; this stays pure.
 *
 * Takes the whole settings object rather than just the interval, matching
 * `@/lib/backup` and `@/lib/hello-world`: a scheduling decision that reads two
 * settings should be handed the settings, not an unlabelled pair.
 */
export function shouldRunNow(
  lastRunAtMs: number | undefined,
  settings: ScheduledRefreshSettings,
  nowMs: number,
  marketIsoDate: string,
): boolean {
  if (settings.marketDaysOnly && !isMarketDay(marketIsoDate)) return false;
  if (lastRunAtMs === undefined) return true;
  return nowMs - lastRunAtMs >= intervalToMinutes(settings.autoRefreshInterval) * 60_000;
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
  const dueAtMs = lastRunAtMs + intervalToMinutes(settings.autoRefreshInterval) * 60_000;
  if (!settings.marketDaysOnly) return dueAtMs;

  // A due time landing on a closed day will not fire then -- `shouldRunNow`
  // refuses it, and the heartbeat keeps asking until the market reopens. Rolling
  // it forward here is what stops the Active Tasks card promising a Thanksgiving
  // run it will not make.
  //
  // The rolled time is local midnight of the next trading day rather than the
  // same clock time: once the interval has already elapsed the job fires on the
  // first heartbeat of that day, so midnight is the honest answer. The date is
  // read on the server's own clock because the answer is rendered next to other
  // server-local timestamps on that card -- a few hours of disagreement with New
  // York around midnight costs nothing here, where `shouldRunNow` is the one
  // that must be exact.
  const dueDate = new Date(dueAtMs);
  const dueIso = toIsoDateLocal(dueDate);
  if (isMarketDay(dueIso)) return dueAtMs;

  const [year, month, day] = nextMarketDay(dueIso).split("-").map(Number);
  return new Date(year, month - 1, day).getTime();
}
