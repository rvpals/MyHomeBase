"use server";

// The web adapters for Administration → Configuration → Backup Data.
//
// Every export authorises on its first line: a server action is its own POST
// endpoint, callable without ever rendering the page, so no layout or page check
// protects it. `requireAdmin` rather than `requireModuleAccess` — a backup folder
// belongs to no module, and choosing where the whole database is copied is
// administration.

import { revalidatePath } from "next/cache";
import {
  BACKUP_SETTING_KEYS,
  NO_FOLDER,
  backupFoldersInputSchema,
  describeBackupPreflight,
  loadBackupSettings,
  runDataBackupNow,
  checkBackupReady,
  type BackupFoldersInput,
  type BackupRunSummary,
} from "@/lib/backup";
import { requireAdmin } from "@/app/(protected)/require-access";
import { updateSettings } from "@/lib/settings";
import { deps } from "@/lib/wiring";

const BACKUP_PATH = "/admin/configuration/backup";

export interface ActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

function toErrorResult(error: unknown, fallback: string): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

/**
 * Saves the two folders and the keep count — and only those three keys.
 *
 * A partial save, not a whole-form one. The schedule (the switch, the cadence and
 * the anchor time) is owned by Administration → Background Tasks now, so writing
 * the full entry list from here would blank three fields this screen does not
 * render. Each screen saves exactly what it shows; that is what makes the split
 * safe. Same reasoning as `saveAutoImportScheduleAction` leaving the Expense
 * watched folder alone.
 *
 * `NO_FOLDER` is written for a blank path rather than `""`: `settingUpdateSchema`
 * rejects an empty value, so a reader could otherwise never clear a path they had
 * already set. `resolveBackupSettings` maps it back.
 */
export async function saveBackupFoldersAction(
  input: BackupFoldersInput,
): Promise<ActionResult> {
  try {
    await requireAdmin();
    const validated = backupFoldersInputSchema.parse(input);
    updateSettings(deps.settingsRepo, [
      {
        key: BACKUP_SETTING_KEYS.attachmentRoot,
        value: validated.attachmentRoot.trim() === "" ? NO_FOLDER : validated.attachmentRoot.trim(),
      },
      {
        key: BACKUP_SETTING_KEYS.databaseRoot,
        value: validated.databaseRoot.trim() === "" ? NO_FOLDER : validated.databaseRoot.trim(),
      },
      { key: BACKUP_SETTING_KEYS.keepCount, value: String(validated.keepCount) },
    ]);
    revalidatePath(BACKUP_PATH);
    revalidatePath("/admin/background-tasks");
    return { ok: true, message: "Backup settings saved." };
  } catch (error) {
    return toErrorResult(error, "Failed to save the backup settings.");
  }
}

/**
 * Lists one folder on the server, for the Browse… dialog.
 *
 * The receipt file store's `listFolders` is reused rather than reimplemented: it
 * already skips dotfiles and NAS housekeeping folders, and maps ENOENT to a
 * readable sentence. Nothing about it is specific to receipts.
 */
export async function browseBackupFoldersAction(path: string) {
  try {
    await requireAdmin();
    return { ok: true, listing: await deps.receiptFileStore.listFolders(path) };
  } catch (error) {
    return toErrorResult(error, "Could not open that folder.");
  }
}

/**
 * Checks one folder is really writable, by writing and removing a probe file.
 *
 * Deliberately does NOT save: it validates the typed-but-unsaved value, so a reader
 * can find out a path is wrong before committing it. Same contract as the HSA
 * receipt root's Check Access.
 */
export async function checkBackupFolderAction(path: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    if (path.trim() === "") return { ok: false, error: "Type or choose a folder first." };

    const check = await deps.backupFileStore.checkRoot(path);
    switch (check.kind) {
      case "ok":
        return { ok: true, message: `The server can write to ${check.path}.` };
      case "missing":
        return { ok: false, error: `There is no folder at ${check.path}.` };
      case "not-a-directory":
        return { ok: false, error: `${check.path} is a file, not a folder.` };
      case "not-writable":
        return {
          ok: false,
          error: `The server cannot write to ${check.path} (${check.reason}). On a Synology, check the shared folder's permissions for the account the app runs as.`,
        };
    }
  } catch (error) {
    return toErrorResult(error, "Could not check that folder.");
  }
}

/** The saved settings' preflight, so the screen can warn before anything is run. */
export async function checkBackupReadyAction(): Promise<ActionResult> {
  try {
    await requireAdmin();
    const ready = await checkBackupReady(loadBackupSettings());
    return ready.ok
      ? { ok: true, message: "Backup is configured and both folders are writable." }
      : { ok: false, error: describeBackupPreflight(ready.failure) };
  } catch (error) {
    return toErrorResult(error, "Could not check the backup configuration.");
  }
}

export interface RunBackupResult extends ActionResult {
  summary?: BackupRunSummary;
}

/**
 * Runs one pass now, ignoring the switch and the interval but NOT the preflight —
 * a manual run against a missing folder must still refuse and say which folder.
 */
export async function runBackupNowAction(): Promise<RunBackupResult> {
  try {
    await requireAdmin();
    const summary = await runDataBackupNow({ force: true });
    revalidatePath(BACKUP_PATH);
    revalidatePath("/admin/background-tasks");
    return summary.ran
      ? { ok: true, message: summary.detail, summary }
      : { ok: false, error: summary.reason ?? "The backup did not run.", summary };
  } catch (error) {
    return toErrorResult(error, "The backup failed.");
  }
}
