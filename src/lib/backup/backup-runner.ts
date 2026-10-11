// Resolves everything the Data backup needs from the composition root and runs one
// pass. Separate from `attachment-backup.ts` / `database-backup.ts` so those stay
// pure orchestration units taking explicit dependencies, while this one knows about
// `deps`, app settings, and the last-run table.
//
// Same split, and the same reasons, as src/lib/scheduled-refresh/refresh-runner.ts.

import { getHouseholdSettings } from "@/lib/household/settings";
import { listSettings } from "@/lib/settings";
import { toSqliteTimestampUtc } from "@/lib/shared/date";
import { deps } from "@/lib/wiring";
import { backupAttachments } from "./attachment-backup";
import { backupDatabase } from "./database-backup";
import {
  checkBackupSettings,
  describeBackupPreflight,
  isBackupEnabled,
  resolveBackupSettings,
  shouldRunNow,
} from "./settings";
import type { BackupPreflight, BackupRunSummary, BackupSettings } from "./types";
import type { ScheduledRun } from "@/lib/scheduled-jobs/types";
import { JOB_KEYS } from "@/lib/scheduled-jobs/types";

export const DATA_BACKUP_JOB_KEY = JOB_KEYS.dataBackup;

/** The saved settings, or the disabled defaults when nothing has been configured. */
export function loadBackupSettings(): BackupSettings {
  return resolveBackupSettings(listSettings(deps.settingsRepo));
}

/** The stored record of the last backup, for the settings screen. */
export function loadLastBackupRun(): ScheduledRun | undefined {
  return deps.scheduledRunRepo.get(DATA_BACKUP_JOB_KEY);
}

/**
 * A stored `last_run_at` as epoch millis, or `undefined` if the job has never run.
 *
 * The column holds a SQLite-style UTC timestamp, which `Date.parse` reads as *local*
 * time unless told otherwise -- that would make the interval look hours off on a NAS
 * that is not on UTC. The trailing "Z" is what makes it unambiguous.
 */
function lastRunAtMs(run: ScheduledRun | undefined): number | undefined {
  if (!run) return undefined;
  const parsed = Date.parse(`${run.lastRunAt.replace(" ", "T")}Z`);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Where the live attachment files are.
 *
 * The HSA receipt root -- the app's only store of user-generated files that are not
 * rows in the database. Read from the Household module's settings rather than
 * duplicated as a backup setting of its own: two places naming the same folder is
 * how a backup ends up pointed at a folder the app stopped using.
 */
export function loadAttachmentSourceRoot(): string {
  return getHouseholdSettings(deps.moduleRepo, deps.moduleSettingsRepo).hsaReceiptRoot;
}

/**
 * The settings check plus the one thing only the filesystem can answer: are both
 * folders actually writable?
 *
 * Run before every pass, scheduled or manual. A backup that silently does nothing
 * because its destination went away is worse than one that refuses and says why.
 */
export async function checkBackupReady(settings: BackupSettings): Promise<BackupPreflight> {
  const fromSettings = checkBackupSettings(settings);
  if (!fromSettings.ok) return fromSettings;

  const attachment = await deps.backupFileStore.checkRoot(settings.attachmentRoot);
  if (attachment.kind !== "ok") {
    return {
      ok: false,
      failure: {
        kind: "attachment-root-unusable",
        path: settings.attachmentRoot,
        reason: attachment.kind === "not-writable" ? attachment.reason : attachment.kind,
      },
    };
  }

  const database = await deps.backupFileStore.checkRoot(settings.databaseRoot);
  if (database.kind !== "ok") {
    return {
      ok: false,
      failure: {
        kind: "database-root-unusable",
        path: settings.databaseRoot,
        reason: database.kind === "not-writable" ? database.reason : database.kind,
      },
    };
  }

  return { ok: true };
}

/** How a finished pass reads in `sys_scheduled_runs.last_detail`. */
function describe(summary: BackupRunSummary): string {
  const parts: string[] = [];
  const attachments = summary.attachments;
  if (attachments) {
    parts.push(`${attachments.copied + attachments.replaced} attachment(s) backed up`);
    if (attachments.failed > 0) parts.push(`${attachments.failed} failed`);
  }
  if (summary.database) {
    const mb = (summary.database.archiveBytes / 1024 / 1024).toFixed(1);
    parts.push(`database ${summary.database.archiveName} (${mb} MB)`);
    if (summary.database.prunedNames.length > 0) {
      parts.push(`${summary.database.prunedNames.length} old archive(s) removed`);
    }
  }
  return parts.length > 0 ? parts.join(", ") : "nothing to do";
}

/**
 * Runs one backup pass, recording it in `sys_scheduled_runs`. Never throws -- a
 * scheduled job must not take the server down.
 *
 * `force` is what the manual "Run backup now" button and the CLI pass: it skips the
 * switch and the interval check but still stamps the run, so pressing the button
 * also postpones the next scheduled pass rather than leaving one queued a minute
 * later. It does NOT skip the preflight: a manual run against a missing folder must
 * still refuse and say which folder.
 */
export async function runDataBackupNow(
  options: { force?: boolean } = {},
): Promise<BackupRunSummary> {
  const skipped = (reason: string): BackupRunSummary => ({ ran: false, reason, detail: reason });

  try {
    const settings = loadBackupSettings();

    if (!options.force) {
      if (!isBackupEnabled(settings)) return skipped("Data backup is switched off.");
      if (!shouldRunNow(lastRunAtMs(loadLastBackupRun()), settings, Date.now())) {
        return skipped("Not due yet.");
      }
    }

    // Checked before the stamp, so a refusal does not burn the interval: a reader
    // who fixes the folder gets a backup on the next tick, not in a day's time.
    const ready = await checkBackupReady(settings);
    if (!ready.ok) return skipped(describeBackupPreflight(ready.failure));

    const sourceRoot = loadAttachmentSourceRoot();
    if (sourceRoot === "") {
      return skipped(
        "No HSA receipt folder is configured, so there are no attachments to back up. Set one on Household → Configuration.",
      );
    }

    // Stamped before the work, so a pass slower than the heartbeat cannot overlap
    // the next one. See migrations/0061.
    deps.scheduledRunRepo.start(DATA_BACKUP_JOB_KEY, toSqliteTimestampUtc(new Date()));

    const now = new Date();
    const attachments = await backupAttachments({
      store: deps.backupFileStore,
      sourceRoot,
      backupRoot: settings.attachmentRoot,
      now,
    });

    const database = await backupDatabase({
      store: deps.backupFileStore,
      snapshotter: deps.databaseSnapshotter,
      compressor: deps.backupCompressor,
      backupRoot: settings.databaseRoot,
      keepCount: settings.keepCount,
      now,
    });

    // The database archive is the part that must not silently half-succeed, and it
    // throws rather than reporting a partial. So `partial` here means exactly one
    // thing: the archive landed but some attachments did not.
    const status = attachments.failed === 0 ? "ok" : "partial";
    const summary: BackupRunSummary = { ran: true, attachments, database, status };
    summary.detail = describe(summary);

    deps.scheduledRunRepo.finish(DATA_BACKUP_JOB_KEY, status, summary.detail);
    return summary;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown backup error.";
    // Best-effort: if the throw came from the database itself this will fail too,
    // and there is nothing useful left to do about it.
    try {
      deps.scheduledRunRepo.finish(DATA_BACKUP_JOB_KEY, "failed", detail);
    } catch {
      // Deliberately empty -- see above.
    }
    return { ran: false, reason: detail, detail, status: "failed" };
  }
}
