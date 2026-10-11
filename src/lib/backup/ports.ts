// The filesystem and database operations a backup pass needs, as ports.
//
// Ports rather than direct `node:fs` calls so the two use-cases stay pure: every
// rule below -- which file is newer, what the archived name is, which archives get
// pruned -- is tested against an in-memory fake, with no temp directory and no real
// database. `file-store.ts` and `sqlite-snapshotter.ts` are the Node adapters.

/** One file found under a root, with the facts the newer-than rule needs. */
export interface BackupFileInfo {
  /** Path relative to the root, using `/` separators on every platform. */
  relativePath: string;
  /** Last-modified time in epoch ms. */
  modifiedAtMs: number;
  sizeBytes: number;
}

/** Whether a folder can be written to, and why not when it can't. */
export type RootCheck =
  | { kind: "ok"; path: string }
  | { kind: "missing"; path: string }
  | { kind: "not-a-directory"; path: string }
  | { kind: "not-writable"; path: string; reason: string };

export interface BackupFileStore {
  /**
   * Every file under `root`, recursively. An absent root is an empty list rather
   * than a throw: a reader who has configured a folder that does not exist yet
   * gets a preflight failure naming it, not a stack trace from a tick.
   */
  listFiles(root: string): Promise<BackupFileInfo[]>;

  /** One file's facts, or undefined when it isn't there. */
  statFile(root: string, relativePath: string): Promise<BackupFileInfo | undefined>;

  /** Copies a file, creating any parent folders. Overwrites the destination. */
  copyFile(fromRoot: string, toRoot: string, relativePath: string): Promise<void>;

  /** Renames a file inside one root. Used to set an older backup copy aside. */
  renameWithin(root: string, fromRelativePath: string, toRelativePath: string): Promise<void>;

  /** Writes bytes to `<root>/<name>`, creating the root if needed. */
  writeFile(root: string, name: string, data: Uint8Array): Promise<void>;

  /** Deletes `<root>/<name>`. A missing file is not an error. */
  deleteFile(root: string, name: string): Promise<void>;

  /** Names of the files directly in `root` (no recursion), for the archive prune. */
  listTopLevelFiles(root: string): Promise<string[]>;

  /**
   * Whether the server can actually write to a folder.
   *
   * Implementations must write and remove a probe file rather than trusting
   * `access(W_OK)`: on an SMB share or a Synology ACL that call reports writable
   * for a folder that then refuses the write. Same reasoning, and the same test,
   * as `NodeReceiptFileStore.checkRoot`.
   */
  checkRoot(root: string): Promise<RootCheck>;
}

/**
 * Takes a consistent point-in-time copy of the live SQLite database.
 *
 * A port because the only honest implementation is SQLite's own `VACUUM INTO`,
 * which needs a real connection -- and because a use-case that merely needs "give
 * me a file I can archive" should not be the thing that knows that.
 */
export interface DatabaseSnapshotter {
  /**
   * Writes a consistent snapshot to `destinationPath` and returns its size.
   *
   * `VACUUM INTO` is used rather than copying `.db` + `-wal` + `-shm`: the app
   * writes continuously (two 60s heartbeats), so three files copied at three
   * instants can be internally inconsistent. A vacuumed snapshot is one already-
   * checkpointed file that needs no sidecars to restore.
   */
  snapshotTo(destinationPath: string): Promise<number>;

  /** Reads a file back, for handing to the compressor. */
  readFile(absolutePath: string): Promise<Uint8Array>;

  /** Removes the staging snapshot once it has been archived. */
  deleteFile(absolutePath: string): Promise<void>;

  /** A path in the OS temp area to stage the snapshot at. */
  stagingPath(name: string): string;
}

/** Compresses one file's bytes. Implemented with `node:zlib` gzip. */
export interface Compressor {
  compress(data: Uint8Array): Promise<Uint8Array>;
}
