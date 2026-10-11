// The Node adapter behind `DatabaseSnapshotter`: takes a consistent copy of the
// live database using SQLite's own `VACUUM INTO`.
//
// Why `VACUUM INTO` and not a file copy. The app runs in WAL mode and writes
// continuously -- two 60s heartbeats, plus whatever a reader is doing. Copying
// `myhomebase.db`, `-wal` and `-shm` captures three files at three different
// instants, which can be internally inconsistent; and the `.db` alone can be
// missing committed rows still sitting in a multi-megabyte WAL (a real release saw
// 4.5 MB, per `scripts/backup-nas-db.mjs`).
//
// `VACUUM INTO` is SQLite's supported online-backup path. It takes a read
// transaction, so it is safe while the app writes, and it produces ONE
// already-checkpointed file that restores on its own with no sidecars. It also
// rebuilds the file without free pages, so the snapshot is usually smaller than the
// live database before compression even starts.

import { readFile, rm } from "node:fs/promises";
import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import type { DatabaseSnapshotter } from "./ports";

export class SqliteDatabaseSnapshotter implements DatabaseSnapshotter {
  constructor(private readonly db: Database.Database) {}

  async snapshotTo(destinationPath: string): Promise<number> {
    // `VACUUM INTO` refuses to overwrite, so a leftover file from an interrupted
    // run would fail every subsequent backup until someone cleared it by hand.
    await rm(destinationPath, { force: true });

    // Parameter binding is not available for VACUUM INTO in SQLite, so the path is
    // interpolated. It is not user input: `stagingPath` builds it from the OS temp
    // directory and a timestamp this module generates. The quotes are doubled so a
    // temp path containing one cannot end the string.
    const quoted = destinationPath.replace(/'/g, "''");
    this.db.exec(`VACUUM INTO '${quoted}'`);

    return (await stat(destinationPath)).size;
  }

  async readFile(absolutePath: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(absolutePath));
  }

  async deleteFile(absolutePath: string): Promise<void> {
    await rm(absolutePath, { force: true });
  }

  stagingPath(name: string): string {
    // The OS temp directory, not the backup folder: the backup destination is often
    // a NAS share, and staging there would write the snapshot over the network once
    // and the archive a second time. It also keeps a half-written snapshot out of
    // the folder the retention prune reads.
    return path.join(os.tmpdir(), name);
  }
}
