import type { BrowsedPage, BrowsedTable, UploadedDatabase } from "./types";

/** What the repository needs to record an upload. */
export interface UploadedDatabaseWriteData {
  originalFileName: string;
  storedFileName: string;
  byteSize: number;
  uploadedByUserId: number | null;
}

/**
 * The metadata rows, in the app's own database.
 *
 * This is the ONLY thing this module writes to `myhomebase.db`. The uploaded
 * files themselves are never opened through here — see `ForeignDatabaseReader`.
 */
export interface UploadedDatabaseRepository {
  list(): UploadedDatabase[];
  getById(id: number): UploadedDatabase | undefined;
  create(input: UploadedDatabaseWriteData): UploadedDatabase;
  delete(id: number): boolean;
}

/** Where the uploaded bytes live. */
export interface SqliteFileStore {
  /**
   * Writes `bytes` under a generated name and returns that name. The store
   * chooses the name so a caller's filename never reaches the filesystem.
   */
  save(bytes: Uint8Array, originalFileName: string): Promise<string>;
  /**
   * The same, from a stream, without ever holding the whole file in memory.
   *
   * This is what the upload route uses. An upload is up to `MAX_UPLOAD_BYTES`, and
   * buffering that to call `save` would cost the server the file's full size
   * per concurrent upload — on a NAS that is the difference between working
   * and swapping.
   *
   * `maxBytes` is enforced *as the stream arrives*: the write is aborted and
   * the partial file removed the moment the limit is passed, so an oversized
   * upload costs the cap rather than the sender's whole file. Returns the
   * stored name and the byte count actually written.
   */
  saveStream(
    stream: ReadableStream<Uint8Array>,
    originalFileName: string,
    maxBytes: number,
  ): Promise<{ storedFileName: string; byteSize: number }>;
  /** The absolute path of a stored file, for the reader to open. */
  pathFor(storedFileName: string): string;
  /** Whether the file is still there — an upload root can be wiped between runs. */
  exists(storedFileName: string): Promise<boolean>;
  /** Removes it. Succeeds silently when it is already gone. */
  remove(storedFileName: string): Promise<void>;
}

/**
 * Reads and edits a *foreign* SQLite file — one the user uploaded, never the
 * app's own database.
 *
 * Every method takes the file's path, so there is no long-lived connection to
 * the wrong database and no way for a caller to hand this an app table name and
 * have it resolved against `myhomebase.db`.
 */
export interface ForeignDatabaseReader {
  /** Whether the file is really a SQLite database, before anything else is tried. */
  isSqliteFile(filePath: string): Promise<boolean>;
  listTables(filePath: string): BrowsedTable[];
  readTable(filePath: string, tableName: string, limit: number): BrowsedPage;
  /** Deletes the addressed rows, in one transaction. Returns how many went. */
  deleteRows(filePath: string, tableName: string, rowIds: number[]): number;
}
