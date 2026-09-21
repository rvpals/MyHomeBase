import type { CsvDelimiter } from "./delimiter";
import type { CsvBrowsedPage, CsvCellChanges, UploadedCsvFile } from "./types";

/** What the repository needs to record an upload. */
export interface UploadedCsvFileWriteData {
  originalFileName: string;
  storedFileName: string;
  tableFileName: string;
  delimiter: CsvDelimiter;
  hasHeaderRow: boolean;
  columnNames: string[];
  rowCount: number;
  byteSize: number;
  uploadedByUserId: number | null;
}

/**
 * The metadata rows, in the app's own database.
 *
 * This is the ONLY thing this module writes to `myhomebase.db`. The rows of an
 * uploaded file live in that file's own SQLite sidecar and are never reachable
 * from here — see `CsvTableStore`.
 */
export interface UploadedCsvFileRepository {
  list(): UploadedCsvFile[];
  getById(id: number): UploadedCsvFile | undefined;
  create(input: UploadedCsvFileWriteData): UploadedCsvFile;
  /** Keeps the picker's count honest after rows are deleted. */
  updateRowCount(id: number, rowCount: number): void;
  delete(id: number): boolean;
}

/** Where the uploaded text and its sidecar live. */
export interface CsvFileStore {
  /**
   * Writes a stream under a generated name without ever holding the whole file
   * in memory, aborting and removing the partial file the moment `maxBytes` is
   * passed. Returns the stored name and the bytes actually written.
   *
   * Same contract as the SQLite browser's store and for the same reason: an
   * upload is up to the configured cap, and buffering that to write it would
   * cost the server the file's full size per concurrent upload.
   */
  saveStream(
    stream: ReadableStream<Uint8Array>,
    originalFileName: string,
    maxBytes: number,
  ): Promise<{ storedFileName: string; byteSize: number }>;
  /** Writes text under a generated name. The CLI path, where the file is already read. */
  saveText(text: string, originalFileName: string): Promise<string>;
  /** The whole stored file as text, for parsing at import. */
  readText(storedFileName: string): Promise<string>;
  /** The absolute path of a stored file, for the sidecar to be created beside. */
  pathFor(storedFileName: string): string;
  /** Whether the file is still there — an upload root can be wiped between runs. */
  exists(storedFileName: string): Promise<boolean>;
  /** Removes it. Succeeds silently when it is already gone. */
  remove(storedFileName: string): Promise<void>;
  /** A generated name for a file's SQLite sidecar. */
  tableNameFor(originalFileName: string): string;
}

/**
 * The rows of one uploaded file, in that file's own SQLite sidecar.
 *
 * Every method takes the sidecar's path, so there is no long-lived connection
 * and no way for a caller to have one of these operations resolve against
 * `myhomebase.db`. Deliberately the same shape as `sqlite-browser`'s
 * `ForeignDatabaseReader`, and for the same reason.
 *
 * Why a sidecar at all, when the upload is already a text file: a delimited
 * file has no row identity and no random access. Editing or deleting a line in
 * place means rewriting the whole file, and doing that on every click both
 * costs the file's full size per edit and loses to the next concurrent writer.
 * Loading once into SQLite buys a rowid, an indexed window read, a real
 * transaction, and the same read/write path the SQLite browser already uses.
 */
export interface CsvTableStore {
  /**
   * Creates the sidecar and loads every row into it, in one transaction.
   * Returns how many rows landed.
   */
  create(sidecarPath: string, columnNames: string[], rows: string[][]): number;
  /** A window of rows, oldest-first by rowid, with the file's total. */
  read(sidecarPath: string, columnNames: string[], limit: number, offset: number): CsvBrowsedPage;
  /** Every row, for the export route. Streams in batches rather than all at once. */
  readAll(sidecarPath: string, columnNames: string[]): Generator<(string | null)[]>;
  /**
   * Writes `changes` to each addressed row, in one transaction. Returns rows
   * written.
   *
   * `columnNames` is the file's own column list, in file order — the sidecar
   * stores columns positionally (`c0..cN`) and holds no names of its own, so
   * this is what turns a change keyed by column name into a column to write.
   */
  update(
    sidecarPath: string,
    columnNames: string[],
    rowIds: number[],
    changes: CsvCellChanges,
  ): number;
  /** Deletes the addressed rows, in one transaction. Returns how many went. */
  deleteRows(sidecarPath: string, rowIds: number[]): number;
  /** How many rows the sidecar now holds. */
  countRows(sidecarPath: string): number;
}
