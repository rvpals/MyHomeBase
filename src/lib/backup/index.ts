// The public surface of the Data backup module.
//
// NOTE ON IMPORTING THIS FROM A CLIENT COMPONENT: don't. `backup-runner` reaches
// into the composition root, which opens the SQLite connection, so pulling this
// index into a `"use client"` file drags better-sqlite3 into the browser bundle and
// the build fails. Client components import the types straight from `./types` --
// same rule, and the same reason, as `src/lib/scheduled-jobs/index.ts`.

export type {
  AttachmentBackupSummary,
  AttachmentFileResult,
  AttachmentFileStatus,
  BackupPreflight,
  BackupPreflightFailure,
  BackupRunSummary,
  BackupSettings,
  DatabaseBackupSummary,
  IntervalUnit,
} from "./types";
export {
  INTERVAL_UNIT_LABELS,
  INTERVAL_UNITS,
  MAX_INTERVAL_COUNT,
  MAX_KEEP_COUNT,
  MIN_HEARTBEAT_MINUTES,
  MIN_INTERVAL_COUNT,
  MIN_KEEP_COUNT,
  NO_FOLDER,
  unitToMinutes,
} from "./types";

export {
  backupFoldersInputSchema,
  backupScheduleInputSchema,
  backupSettingsInputSchema,
  backupFolderSchema,
  intervalCountSchema,
  intervalUnitSchema,
  keepCountSchema,
  startTimeSchema,
  type BackupFoldersInput,
  type BackupScheduleInput,
  type BackupSettingsInput,
} from "./schema";

export {
  BACKUP_SETTING_KEYS,
  DEFAULT_INTERVAL_COUNT,
  DEFAULT_INTERVAL_UNIT,
  DEFAULT_KEEP_COUNT,
  DEFAULT_START_TIME,
  backupSettingsToEntries,
  checkBackupSettings,
  describeBackupInterval,
  describeBackupPreflight,
  intervalToMinutes,
  isBackupEnabled,
  nextRunDueAtMs,
  resolveBackupSettings,
  shouldRunNow,
} from "./settings";

export type { BackupFileInfo, BackupFileStore, Compressor, DatabaseSnapshotter, RootCheck } from "./ports";
export { archivedName, backupAttachments, isNewer, timestampSuffix } from "./attachment-backup";
export { archiveName, archivesToPrune, backupDatabase, isArchiveName } from "./database-backup";
export {
  DATA_BACKUP_JOB_KEY,
  checkBackupReady,
  loadAttachmentSourceRoot,
  loadBackupSettings,
  loadLastBackupRun,
  runDataBackupNow,
} from "./backup-runner";
export { NodeBackupFileStore } from "./file-store";
export { SqliteDatabaseSnapshotter } from "./sqlite-snapshotter";
