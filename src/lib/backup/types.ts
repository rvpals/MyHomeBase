// Domain models for the Data backup job: where backups go, how often, how many
// are kept, and what one pass did.
//
// The settings live in `sys_app_settings` rather than on a module, because this
// job belongs to no module -- see the note on `BACKUP_SETTING_KEYS` in settings.ts.

// Imported as well as re-exported below: `BackupSettings` names the type, and a
// bare `export ... from` would not bring it into this module's own scope.
import type { IntervalUnit } from "@/lib/hello-world/types";

/**
 * The cadence vocabulary, borrowed whole from the "Hello, world!" job.
 *
 * Re-exported rather than redeclared: the unit list, the labels and the
 * minutes-per-unit table are the same facts for every job that runs on a count plus
 * a unit, and a second copy here would be a second thing to keep in step. The
 * heartbeat floor matters just as much to a backup as to a heartbeat -- the
 * scheduler ticks once a minute whatever either job asks for.
 *
 * This replaced a fixed `BACKUP_INTERVALS` enum of hourly/daily/weekly/monthly.
 * The stored `backup_interval` key is superseded by `backup_interval_count` and
 * `backup_interval_unit` (migrations/0138) and is no longer read.
 */
export {
  INTERVAL_UNITS,
  INTERVAL_UNIT_LABELS,
  MAX_INTERVAL_COUNT,
  MIN_HEARTBEAT_MINUTES,
  MIN_INTERVAL_COUNT,
  unitToMinutes,
} from "@/lib/hello-world/types";
export type { IntervalUnit } from "@/lib/hello-world/types";

/** The fewest and most backups a reader may ask to keep. */
export const MIN_KEEP_COUNT = 1;
export const MAX_KEEP_COUNT = 100;

/**
 * The stored sentinel for "no folder chosen".
 *
 * `settingUpdateSchema` requires a non-empty value, so a blank path cannot be
 * written to `sys_app_settings` at all. Every read maps this back to `""`, so the
 * rest of the app never sees the sentinel -- the same trick as `NO_NAV_TEXTURE`.
 */
export const NO_FOLDER = "none";

export interface BackupSettings {
  /** Master switch for the scheduled pass. A manual run ignores it. */
  enabled: boolean;
  /** Where attachment files are copied to. `""` = not set. */
  attachmentRoot: string;
  /** Where the Document Library's files are copied to. `""` = not set. */
  documentRoot: string;
  /** Where the database archives are written. `""` = not set. */
  databaseRoot: string;
  /** How many database archives to keep. Older ones are deleted after a good write. */
  keepCount: number;
  /** The number half of the cadence: "every <count> <unit>". */
  intervalCount: number;
  intervalUnit: IntervalUnit;
  /**
   * The time of day the schedule is anchored to, as `HH:MM` in 24h local time.
   *
   * Kept when the fixed interval enum gave way to a count and a unit: it is what
   * makes "every 1 day" mean 02:00 rather than "24h after whenever this was first
   * armed". It anchors the *first* run only -- see `shouldRunNow`.
   */
  startTime: string;
}

/** What one attachment file's backup did. */
export type AttachmentFileStatus =
  /** No copy existed in the backup folder, so one was made. */
  | "copied"
  /** A copy existed and was older, so it was renamed aside and replaced. */
  | "replaced"
  /** The backup copy was the same age or newer, so nothing was done. */
  | "skipped"
  | "failed";

export interface AttachmentFileResult {
  /** The file's path relative to the attachment root. */
  relativePath: string;
  status: AttachmentFileStatus;
  /** The name an older copy was renamed to, when `status` is `replaced`. */
  archivedAs?: string;
  /** Why it failed. Only set when `status` is `failed`. */
  error?: string;
}

export interface AttachmentBackupSummary {
  files: AttachmentFileResult[];
  copied: number;
  replaced: number;
  skipped: number;
  failed: number;
}

export interface DatabaseBackupSummary {
  /** The archive written, e.g. `2026-10-09-17-00-00.zip`. */
  archiveName: string;
  /** The archive's size on disk, after compression. */
  archiveBytes: number;
  /** Archives deleted to honour `keepCount`. */
  prunedNames: string[];
}

/**
 * Why a pass could not run. Each maps to one sentence on the admin screen, so the
 * reader is told which setting is missing rather than "not configured".
 */
export type BackupPreflightFailure =
  | { kind: "attachment-root-not-set" }
  | { kind: "document-root-not-set" }
  | { kind: "database-root-not-set" }
  | { kind: "keep-count-invalid"; keepCount: number }
  | { kind: "attachment-root-unusable"; path: string; reason: string }
  | { kind: "document-root-unusable"; path: string; reason: string }
  | { kind: "database-root-unusable"; path: string; reason: string };

export type BackupPreflight = { ok: true } | { ok: false; failure: BackupPreflightFailure };

/** What one whole pass did. The shape every scheduled runner in this app returns. */
export interface BackupRunSummary {
  ran: boolean;
  /** Why it did not run. Only set when `ran` is false. */
  reason?: string;
  attachments?: AttachmentBackupSummary;
  documents?: AttachmentBackupSummary;
  database?: DatabaseBackupSummary;
  /** The one-liner stored in `sys_scheduled_runs.last_detail`. */
  detail?: string;
  status?: "ok" | "partial" | "failed";
}
