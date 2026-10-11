// Pure settings resolution and the scheduling decision for the "Hello, world!" job.
// No I/O, no timers, no `deps` -- which is what makes "is it time yet?" testable
// without waiting for a clock. `runner.ts` is the half that knows about the
// composition root.
//
// Modelled on src/lib/backup/settings.ts, which this job's shape follows exactly:
// app-wide keys in `sys_app_settings`, because the job belongs to no module.

import {
  INTERVAL_UNITS,
  MAX_INTERVAL_COUNT,
  MAX_MESSAGE_LENGTH,
  MIN_HEARTBEAT_MINUTES,
  MIN_INTERVAL_COUNT,
  unitToMinutes,
  type HelloWorldSettings,
  type IntervalUnit,
} from "./types";

/**
 * The job's keys in `sys_app_settings`.
 *
 * Spelled here once. These strings are a key column in that table, so renaming one
 * orphans stored state -- the same rule as the icon slot ids and the backup keys.
 */
export const HELLO_WORLD_SETTING_KEYS = {
  enabled: "hello_world_enabled",
  message: "hello_world_message",
  intervalCount: "hello_world_interval_count",
  intervalUnit: "hello_world_interval_unit",
} as const;

export const DEFAULT_MESSAGE = "Hello, world!";
export const DEFAULT_INTERVAL_COUNT = 1;
export const DEFAULT_INTERVAL_UNIT: IntervalUnit = "minute";

function isIntervalUnit(value: string | undefined): value is IntervalUnit {
  return value !== undefined && (INTERVAL_UNITS as readonly string[]).includes(value);
}

/**
 * Parses the stored rows into typed values.
 *
 * Every field degrades to a safe default rather than throwing: this runs inside a
 * background tick where a throw would be invisible, and a hand-edited row saying
 * "every 7 fortnights" should fall back to the safe cadence, not kill the scheduler.
 * The switch defaults to **off**, so an install that upgrades into this job does not
 * start writing run rows nobody asked for.
 */
export function resolveHelloWorldSettings(
  rows: { key: string; value: string }[],
): HelloWorldSettings {
  const byKey = new Map(rows.map((row) => [row.key, row.value]));

  const rawEnabled = byKey.get(HELLO_WORLD_SETTING_KEYS.enabled);
  const rawMessage = byKey.get(HELLO_WORLD_SETTING_KEYS.message);
  const rawCount = Number(byKey.get(HELLO_WORLD_SETTING_KEYS.intervalCount));
  const rawUnit = byKey.get(HELLO_WORLD_SETTING_KEYS.intervalUnit)?.trim();

  // A blank stored message resolves to the default rather than to "", so the job
  // never records an empty detail line that reads as though it did nothing.
  const message = (rawMessage ?? "").trim();

  return {
    enabled: rawEnabled?.trim().toLowerCase() === "true",
    message: message === "" ? DEFAULT_MESSAGE : message.slice(0, MAX_MESSAGE_LENGTH),
    intervalCount:
      Number.isFinite(rawCount) &&
      Number.isInteger(rawCount) &&
      rawCount >= MIN_INTERVAL_COUNT &&
      rawCount <= MAX_INTERVAL_COUNT
        ? rawCount
        : DEFAULT_INTERVAL_COUNT,
    intervalUnit: isIntervalUnit(rawUnit) ? rawUnit : DEFAULT_INTERVAL_UNIT,
  };
}

/**
 * Serializes settings back into app-setting entries.
 *
 * The message is written through `DEFAULT_MESSAGE` when blank: `settingUpdateSchema`
 * rejects an empty value, so a blank could not be stored at all. Same constraint the
 * backup folders solve with their `NO_FOLDER` sentinel -- here a default sentence is
 * more useful than a sentinel, because an empty message has no meaning for this job.
 */
export function helloWorldSettingsToEntries(
  settings: HelloWorldSettings,
): { key: string; value: string }[] {
  const message = settings.message.trim();
  return [
    { key: HELLO_WORLD_SETTING_KEYS.enabled, value: settings.enabled ? "true" : "false" },
    {
      key: HELLO_WORLD_SETTING_KEYS.message,
      value: message === "" ? DEFAULT_MESSAGE : message.slice(0, MAX_MESSAGE_LENGTH),
    },
    { key: HELLO_WORLD_SETTING_KEYS.intervalCount, value: String(settings.intervalCount) },
    { key: HELLO_WORLD_SETTING_KEYS.intervalUnit, value: settings.intervalUnit },
  ];
}

/**
 * The cadence in minutes: "every 90 seconds" is 1.5.
 *
 * Deliberately not rounded. The heartbeat floor is applied in `shouldRunNow`, where
 * it belongs -- a cadence of 1.5 minutes is a true statement about what the reader
 * asked for, and conflating it with what the timer can deliver here would hide the
 * difference from `nextRunDueAtMs` too.
 */
export function intervalToMinutes(settings: HelloWorldSettings): number {
  return settings.intervalCount * unitToMinutes(settings.intervalUnit);
}

/**
 * Whether enough time has passed to run again.
 *
 * A never-run armed job runs on the next tick, matching the expense importer: there
 * is nothing to anchor a first run to, and waiting a full interval to say hello for
 * the first time would make a freshly-armed job look broken.
 *
 * The heartbeat floor is applied here and nowhere else. A sub-minute cadence cannot
 * fire faster than the 60s tick regardless, so comparing against the raw 0.5 minutes
 * would return true on every tick -- which is the same answer, arrived at by accident.
 * Clamping makes the intent explicit.
 */
export function shouldRunNow(
  lastRunAtMs: number | undefined,
  settings: HelloWorldSettings,
  nowMs: number,
): boolean {
  if (!isHelloWorldEnabled(settings)) return false;
  if (lastRunAtMs === undefined) return true;
  const minutes = Math.max(intervalToMinutes(settings), MIN_HEARTBEAT_MINUTES);
  return nowMs - lastRunAtMs >= minutes * 60_000;
}

/**
 * When the next run is due, given the last one. `undefined` when the job is off or
 * has never run -- there is no meaningful "next" in either case, and the Active
 * Tasks card says "On the next check" rather than inventing a time.
 *
 * Uses the same clamped cadence as `shouldRunNow`, so the time shown on the card is
 * the time the job will actually fire rather than one the heartbeat cannot hit.
 */
export function nextRunDueAtMs(
  lastRunAtMs: number | undefined,
  settings: HelloWorldSettings,
): number | undefined {
  if (!isHelloWorldEnabled(settings) || lastRunAtMs === undefined) return undefined;
  const minutes = Math.max(intervalToMinutes(settings), MIN_HEARTBEAT_MINUTES);
  return lastRunAtMs + minutes * 60_000;
}

/**
 * True when the scheduled pass should run.
 *
 * Just the switch, unlike the expense importer and the backup: this job has no
 * folder and no external precondition, so there is nothing that could be switched on
 * and still unable to run. The resolver guarantees a usable message and cadence.
 */
export function isHelloWorldEnabled(settings: HelloWorldSettings): boolean {
  return settings.enabled;
}

/**
 * How the cadence reads in a sentence: "every 5 minute(s)".
 *
 * Shared by the admin card and the CLI so the two never word it differently, and the
 * single place the sub-minute caveat is appended.
 */
export function describeInterval(settings: HelloWorldSettings): string {
  const base = `every ${settings.intervalCount} ${settings.intervalUnit}(s)`;
  return intervalToMinutes(settings) < MIN_HEARTBEAT_MINUTES
    ? `${base} — but the scheduler checks once a minute, so it runs once a minute`
    : base;
}
