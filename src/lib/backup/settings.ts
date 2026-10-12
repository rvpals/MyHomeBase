// Pure settings resolution and the scheduling decision for the Data backup job.
// No I/O, no timers, no `deps` -- which is what makes "is it time yet?" testable
// without waiting for a clock. `backup-runner.ts` is the half that knows about the
// composition root.
//
// Modelled on src/lib/scheduled-refresh/settings.ts, with one difference that
// matters: those settings hang off a module, and this job belongs to none, so
// these live in `sys_app_settings` as plain app-wide keys.

import {
  INTERVAL_UNITS,
  MAX_INTERVAL_COUNT,
  MAX_KEEP_COUNT,
  MIN_HEARTBEAT_MINUTES,
  MIN_INTERVAL_COUNT,
  MIN_KEEP_COUNT,
  NO_FOLDER,
  unitToMinutes,
  type BackupPreflight,
  type BackupPreflightFailure,
  type BackupSettings,
  type IntervalUnit,
} from "./types";

/**
 * The job's row in `sys_scheduled_runs`, and its keys in `sys_app_settings`.
 *
 * Spelled here once. These strings are a primary key in one table and a key column
 * in another, so renaming one orphans stored state -- the same rule as the icon
 * slot ids.
 */
export const BACKUP_SETTING_KEYS = {
  enabled: "backup_enabled",
  attachmentRoot: "backup_attachment_root",
  databaseRoot: "backup_database_root",
  keepCount: "backup_keep_count",
  intervalCount: "backup_interval_count",
  intervalUnit: "backup_interval_unit",
  startTime: "backup_start_time",
} as const;

export const DEFAULT_KEEP_COUNT = 7;
export const DEFAULT_START_TIME = "02:00";
export const DEFAULT_INTERVAL_COUNT = 1;
export const DEFAULT_INTERVAL_UNIT: IntervalUnit = "day";

/**
 * The cadence in minutes: "every 90 seconds" is 1.5.
 *
 * Deliberately not rounded, and deliberately not clamped -- the heartbeat floor is
 * applied in `shouldRunNow` and `nextRunDueAtMs`, where it belongs. A cadence of 1.5
 * minutes is a true statement about what the reader asked for; conflating it with
 * what the 60s timer can deliver here would hide the difference from both callers.
 * Same split as `intervalToMinutes` in src/lib/hello-world/settings.ts.
 */
export function intervalToMinutes(settings: BackupSettings): number {
  return settings.intervalCount * unitToMinutes(settings.intervalUnit);
}

function isIntervalUnit(value: string | undefined): value is IntervalUnit {
  return value !== undefined && (INTERVAL_UNITS as readonly string[]).includes(value);
}

/** Maps the stored sentinel back to a blank path. See `NO_FOLDER`. */
function readFolder(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed === "" || trimmed === NO_FOLDER ? "" : trimmed;
}

/**
 * Parses the stored rows into typed values.
 *
 * Every field degrades to a safe default rather than throwing: this runs inside a
 * background tick where a throw would be invisible, and a hand-edited row saying
 * "every 7 minutes" should fall back to the safe cadence, not kill the scheduler.
 * The switch defaults to **off**, so an install that has never configured a backup
 * does not start writing archives to a folder nobody chose.
 */
export function resolveBackupSettings(rows: { key: string; value: string }[]): BackupSettings {
  const byKey = new Map(rows.map((row) => [row.key, row.value]));

  const rawEnabled = byKey.get(BACKUP_SETTING_KEYS.enabled);
  const rawKeep = Number(byKey.get(BACKUP_SETTING_KEYS.keepCount));
  const rawCount = Number(byKey.get(BACKUP_SETTING_KEYS.intervalCount));
  const rawUnit = byKey.get(BACKUP_SETTING_KEYS.intervalUnit)?.trim();
  const rawStart = byKey.get(BACKUP_SETTING_KEYS.startTime)?.trim();

  return {
    enabled: rawEnabled?.trim().toLowerCase() === "true",
    attachmentRoot: readFolder(byKey.get(BACKUP_SETTING_KEYS.attachmentRoot)),
    databaseRoot: readFolder(byKey.get(BACKUP_SETTING_KEYS.databaseRoot)),
    keepCount:
      Number.isFinite(rawKeep) && rawKeep >= MIN_KEEP_COUNT && rawKeep <= MAX_KEEP_COUNT
        ? Math.floor(rawKeep)
        : DEFAULT_KEEP_COUNT,
    intervalCount:
      Number.isFinite(rawCount) &&
      Number.isInteger(rawCount) &&
      rawCount >= MIN_INTERVAL_COUNT &&
      rawCount <= MAX_INTERVAL_COUNT
        ? rawCount
        : DEFAULT_INTERVAL_COUNT,
    intervalUnit: isIntervalUnit(rawUnit) ? rawUnit : DEFAULT_INTERVAL_UNIT,
    startTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(rawStart ?? "")
      ? (rawStart as string)
      : DEFAULT_START_TIME,
  };
}

/**
 * Serializes settings back into app-setting entries.
 *
 * A blank folder is written as `NO_FOLDER`, never as `""`: `settingUpdateSchema`
 * rejects an empty value, so writing a blank would throw at the boundary and the
 * reader could never clear a path they had already set.
 */
export function backupSettingsToEntries(
  settings: BackupSettings,
): { key: string; value: string }[] {
  return [
    { key: BACKUP_SETTING_KEYS.enabled, value: settings.enabled ? "true" : "false" },
    {
      key: BACKUP_SETTING_KEYS.attachmentRoot,
      value: settings.attachmentRoot.trim() === "" ? NO_FOLDER : settings.attachmentRoot.trim(),
    },
    {
      key: BACKUP_SETTING_KEYS.databaseRoot,
      value: settings.databaseRoot.trim() === "" ? NO_FOLDER : settings.databaseRoot.trim(),
    },
    { key: BACKUP_SETTING_KEYS.keepCount, value: String(settings.keepCount) },
    { key: BACKUP_SETTING_KEYS.intervalCount, value: String(settings.intervalCount) },
    { key: BACKUP_SETTING_KEYS.intervalUnit, value: settings.intervalUnit },
    { key: BACKUP_SETTING_KEYS.startTime, value: settings.startTime },
  ];
}

/** Minutes past local midnight for an `HH:MM` string. */
export function toMinutesOfDay(startTime: string): number {
  const [hours, minutes] = startTime.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * The first moment at or after `fromMs` that lands on the configured start time.
 *
 * This is what anchors the cadence to the reader's chosen time: without it, "every
 * day at 17:00" would mean "24h after whenever the first run happened to fire".
 * Local time deliberately -- 17:00 means 17:00 where the NAS is, and a reader who
 * picked an evening backup should not find it running at lunchtime in summer.
 */
export function firstRunAtOrAfter(fromMs: number, startTime: string): number {
  const anchor = new Date(fromMs);
  anchor.setHours(0, 0, 0, 0);
  anchor.setMinutes(toMinutesOfDay(startTime));
  if (anchor.getTime() < fromMs) anchor.setDate(anchor.getDate() + 1);
  return anchor.getTime();
}

/**
 * Whether enough time has passed to run again.
 *
 * `lastRunAtMs === undefined` means "never run", and the answer is then whether the
 * configured start time has come round at least once -- not an immediate yes. A
 * fresh install that sets "every day at 17:00" at breakfast should wait until the
 * evening rather than taking its first backup the moment the switch is flipped.
 */
export function shouldRunNow(
  lastRunAtMs: number | undefined,
  settings: BackupSettings,
  nowMs: number,
  installedAtMs?: number,
): boolean {
  if (lastRunAtMs === undefined) {
    // Without an install reference the only safe reading is "the anchor has passed
    // today", which `firstRunAtOrAfter` gives relative to the start of today.
    const startOfToday = new Date(nowMs);
    startOfToday.setHours(0, 0, 0, 0);
    const firstDue = firstRunAtOrAfter(installedAtMs ?? startOfToday.getTime(), settings.startTime);
    return nowMs >= firstDue;
  }
  // Clamped to the heartbeat, like the "Hello, world!" job: the scheduler ticks
  // once a minute, so a sub-minute cadence cannot fire faster than that whatever
  // the stored value says. Comparing against the raw 0.5 minutes would return true
  // on every tick -- the same answer, arrived at by accident. The stored value is
  // left exactly as the reader typed it; the screen explains the floor.
  const minutes = Math.max(intervalToMinutes(settings), MIN_HEARTBEAT_MINUTES);
  return nowMs - lastRunAtMs >= minutes * 60_000;
}

/**
 * When the next run is due, given the last one. `undefined` when the job is off --
 * there is no meaningful "next" for a switched-off job.
 *
 * A never-run job reports its anchor time, which is the honest answer and what the
 * Active Tasks card shows.
 */
export function nextRunDueAtMs(
  lastRunAtMs: number | undefined,
  settings: BackupSettings,
  nowMs: number,
): number | undefined {
  if (!settings.enabled) return undefined;
  if (lastRunAtMs === undefined) {
    const startOfToday = new Date(nowMs);
    startOfToday.setHours(0, 0, 0, 0);
    return firstRunAtOrAfter(startOfToday.getTime(), settings.startTime);
  }
  // Same clamp as `shouldRunNow`, so the time the Active Tasks card shows is the
  // time the job will actually fire rather than one the heartbeat cannot hit.
  const minutes = Math.max(intervalToMinutes(settings), MIN_HEARTBEAT_MINUTES);
  return lastRunAtMs + minutes * 60_000;
}

/**
 * Whether the settings describe a backup that could actually run.
 *
 * Separate from `enabled`: a switched-on job with no database folder is misconfigured,
 * not armed, and the difference is what the admin screen's warning says. Folder
 * *reachability* is not checked here -- that needs the filesystem, and lives in
 * `checkBackupRoots` in the runner.
 */
export function checkBackupSettings(settings: BackupSettings): BackupPreflight {
  const failure = findSettingsFailure(settings);
  return failure ? { ok: false, failure } : { ok: true };
}

function findSettingsFailure(settings: BackupSettings): BackupPreflightFailure | undefined {
  if (settings.attachmentRoot === "") return { kind: "attachment-root-not-set" };
  if (settings.databaseRoot === "") return { kind: "database-root-not-set" };
  if (
    !Number.isInteger(settings.keepCount) ||
    settings.keepCount < MIN_KEEP_COUNT ||
    settings.keepCount > MAX_KEEP_COUNT
  ) {
    return { kind: "keep-count-invalid", keepCount: settings.keepCount };
  }
  return undefined;
}

/** True when the scheduled pass should run: configured *and* switched on. */
export function isBackupEnabled(settings: BackupSettings): boolean {
  return settings.enabled && checkBackupSettings(settings).ok;
}

/** How a failed preflight reads. The web and the CLI share this wording. */
export function describeBackupPreflight(failure: BackupPreflightFailure): string {
  switch (failure.kind) {
    case "attachment-root-not-set":
      return "No attachment backup folder is set. Choose one on Administration → Configuration → Backup Data.";
    case "database-root-not-set":
      return "No database backup folder is set. Choose one on Administration → Configuration → Backup Data.";
    case "keep-count-invalid":
      return `Keep how many backups must be a whole number between ${MIN_KEEP_COUNT} and ${MAX_KEEP_COUNT} (it is ${failure.keepCount}).`;
    case "attachment-root-unusable":
      return `The server cannot write to the attachment backup folder ${failure.path} (${failure.reason}).`;
    case "database-root-unusable":
      return `The server cannot write to the database backup folder ${failure.path} (${failure.reason}).`;
  }
}

/**
 * How the cadence reads in a sentence: "every 1 day(s) at 02:00".
 *
 * Shared by the admin card and the CLI so the two never word it differently, and
 * the single place the sub-minute caveat is appended. Mirrors `describeInterval`
 * in src/lib/hello-world/settings.ts, plus the anchor time this job keeps.
 */
export function describeBackupInterval(settings: BackupSettings): string {
  const base = `every ${settings.intervalCount} ${settings.intervalUnit}(s)`;
  const anchored = `${base}, anchored to ${settings.startTime}`;
  return intervalToMinutes(settings) < MIN_HEARTBEAT_MINUTES
    ? `${anchored} — but the scheduler checks once a minute, so it runs once a minute`
    : anchored;
}
