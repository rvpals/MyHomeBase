// Backs up attachment files: copy anything new, set an older backup copy aside
// before replacing it, and leave anything already current alone.
//
// Pure orchestration -- every filesystem touch goes through `BackupFileStore`, so
// each rule below is tested against an in-memory fake.
//
// The rule, in the order it is applied to each source file:
//   1. No copy in the backup folder        -> copy it.                 ("copied")
//   2. A copy exists and the source is newer -> rename the existing copy to
//      `name_YYYY-MM-DD-HH-MM-SS.ext`, then copy the source over.      ("replaced")
//   3. A copy exists and is the same age or newer -> do nothing.       ("skipped")
//
// Why rename rather than overwrite: the backup folder is the only other copy of a
// receipt. Overwriting means a file corrupted or wrongly edited at source quietly
// destroys the good copy on the next pass, and the reader finds out when they need
// it. Renaming keeps every version that was ever backed up, at the cost of disk --
// which is the trade a backup is supposed to make.

import type { BackupFileInfo, BackupFileStore } from "./ports";
import type { AttachmentBackupSummary, AttachmentFileResult } from "./types";

/**
 * The timestamp suffix an outgoing copy is renamed with, in local time.
 *
 * Local rather than UTC, and `-` rather than `:`, matching the archive names in
 * `scripts/backup-nas-db.mjs`: these names are read by a person looking in a folder,
 * and `:` is not a legal filename character on Windows or an SMB share.
 */
export function timestampSuffix(instant: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${instant.getFullYear()}-${p(instant.getMonth() + 1)}-${p(instant.getDate())}` +
    `-${p(instant.getHours())}-${p(instant.getMinutes())}-${p(instant.getSeconds())}`
  );
}

/**
 * `notes/receipt.pdf` -> `notes/receipt_2026-10-09-17-00-00.pdf`.
 *
 * The stamp goes before the extension, not after, so the archived copy still opens
 * in whatever reads a `.pdf`. A file with no extension simply gets the suffix.
 */
export function archivedName(relativePath: string, instant: Date): string {
  const slash = relativePath.lastIndexOf("/");
  const dir = slash === -1 ? "" : relativePath.slice(0, slash + 1);
  const base = slash === -1 ? relativePath : relativePath.slice(slash + 1);

  // `lastIndexOf` on the basename, and `> 0` so a dotfile like `.env` is treated as
  // a name with no extension rather than an empty name with the extension "env".
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";

  return `${dir}${stem}_${timestampSuffix(instant)}${ext}`;
}

/**
 * Whether a source file should replace the copy in the backup folder.
 *
 * Strictly newer, so a pass over an unchanged folder does nothing at all. Equal
 * timestamps mean the file is the one already backed up: copying it again would
 * rename the good copy aside and fill the folder with identical duplicates on
 * every run.
 *
 * Size is deliberately NOT part of this. A file edited in place within the same
 * second would be missed by a size check too, and bringing it in would mean copying
 * on any size change even when the backup copy is the newer one.
 */
export function isNewer(source: BackupFileInfo, backup: BackupFileInfo | undefined): boolean {
  if (!backup) return true;
  return source.modifiedAtMs > backup.modifiedAtMs;
}

export interface AttachmentBackupInput {
  store: BackupFileStore;
  /** Where the live attachment files are. */
  sourceRoot: string;
  /** Where they are backed up to. */
  backupRoot: string;
  /** Stamp for any rename this pass makes. Injected so the test is not timing-dependent. */
  now: Date;
}

/**
 * Backs up every file under `sourceRoot` into `backupRoot`.
 *
 * One file's failure does not stop the pass: the remaining files are still backed
 * up and the failure is reported in its own row. A pass that aborted on the first
 * unreadable file would leave a reader with a partial backup and no idea which
 * files were missed.
 */
export async function backupAttachments({
  store,
  sourceRoot,
  backupRoot,
  now,
}: AttachmentBackupInput): Promise<AttachmentBackupSummary> {
  const sources = await store.listFiles(sourceRoot);
  const files: AttachmentFileResult[] = [];

  for (const source of sources) {
    try {
      const existing = await store.statFile(backupRoot, source.relativePath);

      if (!isNewer(source, existing)) {
        files.push({ relativePath: source.relativePath, status: "skipped" });
        continue;
      }

      if (!existing) {
        await store.copyFile(sourceRoot, backupRoot, source.relativePath);
        files.push({ relativePath: source.relativePath, status: "copied" });
        continue;
      }

      // Rename first, copy second. The other order would overwrite the good copy
      // and leave nothing to rename if the copy then failed.
      const archived = archivedName(source.relativePath, now);
      await store.renameWithin(backupRoot, source.relativePath, archived);
      await store.copyFile(sourceRoot, backupRoot, source.relativePath);
      files.push({ relativePath: source.relativePath, status: "replaced", archivedAs: archived });
    } catch (error) {
      files.push({
        relativePath: source.relativePath,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    files,
    copied: files.filter((file) => file.status === "copied").length,
    replaced: files.filter((file) => file.status === "replaced").length,
    skipped: files.filter((file) => file.status === "skipped").length,
    failed: files.filter((file) => file.status === "failed").length,
  };
}
