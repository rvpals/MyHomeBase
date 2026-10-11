// Backs up the SQLite database: one consistent snapshot, compressed into a
// timestamped archive, then the oldest archives deleted down to the keep count.
//
// Pure orchestration -- the snapshot, the compression and every filesystem touch
// are ports, so the retention rule below is tested without a real database.
//
// Two ordering decisions carry the whole safety of this file:
//
//   * The snapshot is taken with `VACUUM INTO`, not by copying `.db` + `-wal` +
//     `-shm`. The app writes continuously (two 60s heartbeats), so three files
//     copied at three instants can be internally inconsistent -- the exact failure
//     a backup exists to prevent. A vacuumed snapshot is one already-checkpointed
//     file that restores on its own with no sidecars.
//
//   * The prune runs AFTER the new archive is written, never before. Pruning first
//     would mean a run that then failed had deleted a good backup and produced
//     nothing -- turning the backup job into the thing that loses the data.

import type { Compressor, DatabaseSnapshotter, BackupFileStore } from "./ports";
import type { DatabaseBackupSummary } from "./types";

/** `2026-10-09-17-00-00` -- the stamp that names one archive, in local time. */
export function archiveStamp(instant: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${instant.getFullYear()}-${p(instant.getMonth() + 1)}-${p(instant.getDate())}` +
    `-${p(instant.getHours())}-${p(instant.getMinutes())}-${p(instant.getSeconds())}`
  );
}

export function archiveName(instant: Date): string {
  return `${archiveStamp(instant)}.zip`;
}

/** Matches only the names this job writes, so nothing else in the folder is pruned. */
const ARCHIVE_NAME = /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.zip$/;

export function isArchiveName(name: string): boolean {
  return ARCHIVE_NAME.test(name);
}

/**
 * Which archives to delete so that `keepCount` remain.
 *
 * Sorted by name, which for this stamp format is the same as sorting by age --
 * that is the reason the stamp is big-endian. Names that are not this job's
 * archives are ignored entirely: a reader's own file sitting in the backup folder
 * must never be deleted by a retention rule it was never part of.
 */
export function archivesToPrune(names: string[], keepCount: number): string[] {
  const archives = names.filter(isArchiveName).sort();
  const excess = archives.length - keepCount;
  return excess > 0 ? archives.slice(0, excess) : [];
}

export interface DatabaseBackupInput {
  store: BackupFileStore;
  snapshotter: DatabaseSnapshotter;
  compressor: Compressor;
  /** Where archives are written. */
  backupRoot: string;
  /** How many archives to keep, including the one about to be written. */
  keepCount: number;
  /** Stamp for this archive. Injected so the test is not timing-dependent. */
  now: Date;
}

/**
 * Takes one database backup.
 *
 * Throws on a failed snapshot or a failed write -- unlike the attachment pass,
 * there is no partial success here: either an archive landed or it did not, and
 * the runner reports the failure. The staging file is removed either way.
 */
export async function backupDatabase({
  store,
  snapshotter,
  compressor,
  backupRoot,
  keepCount,
  now,
}: DatabaseBackupInput): Promise<DatabaseBackupSummary> {
  const name = archiveName(now);
  const staging = snapshotter.stagingPath(`myhomebase-backup-${archiveStamp(now)}.db`);

  let archiveBytes = 0;
  try {
    await snapshotter.snapshotTo(staging);
    const snapshot = await snapshotter.readFile(staging);
    const compressed = await compressor.compress(snapshot);
    await store.writeFile(backupRoot, name, compressed);
    archiveBytes = compressed.byteLength;
  } finally {
    // Best-effort: a staging file left behind is clutter in the temp folder, not a
    // failed backup, so a failure to remove it must not mask the real outcome.
    try {
      await snapshotter.deleteFile(staging);
    } catch {
      // Nothing useful to do here -- see above.
    }
  }

  // Only now that the new archive is safely on disk.
  const prunedNames: string[] = [];
  for (const old of archivesToPrune(await store.listTopLevelFiles(backupRoot), keepCount)) {
    await store.deleteFile(backupRoot, old);
    prunedNames.push(old);
  }

  return { archiveName: name, archiveBytes, prunedNames };
}
