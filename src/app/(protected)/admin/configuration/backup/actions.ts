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
  backupSettingsInputSchema,
  backupSettingsToEntries,
  describeBackupPreflight,
  loadBackupSettings,
  runDataBackupNow,
  checkBackupReady,
  type BackupRunSummary,
  type BackupSettingsInput,
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

/** Saves the whole form. Validation is the schema's, so the boundary is one call. */
export async function saveBackupSettingsAction(
  input: BackupSettingsInput,
): Promise<ActionResult> {
  try {
    await requireAdmin();
    const validated = backupSettingsInputSchema.parse(input);
    updateSettings(deps.settingsRepo, backupSettingsToEntries(validated));
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
