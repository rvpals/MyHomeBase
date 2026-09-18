import type { ForeignDatabaseReader, SqliteFileStore, UploadedDatabaseRepository } from "./ports";
import {
  deleteRowsSchema,
  readTableSchema,
  uploadDatabaseSchema,
  type DeleteRowsInput,
  type ReadTableInput,
  type UploadDatabaseInput,
} from "./schema";
import type { BrowsedPage, BrowsedTable, DeleteRowsResult, UploadedDatabase } from "./types";

/** The dependencies every use-case here needs, passed rather than constructed. */
export interface SqliteBrowserDeps {
  repo: UploadedDatabaseRepository;
  fileStore: SqliteFileStore;
  reader: ForeignDatabaseReader;
}

/** Every uploaded file, newest first. */
export function listUploadedDatabases(repo: UploadedDatabaseRepository): UploadedDatabase[] {
  return repo.list();
}

/**
 * Stores an uploaded file and records it.
 *
 * The bytes are written first and the row second, so a failed write leaves no
 * row pointing at a file that isn't there. The reverse order would put a
 * phantom in the picker. If the row insert fails the file is removed again,
 * since nothing would ever reference it.
 *
 * The file is checked to really be SQLite *before* the row is written: a
 * mis-picked CSV should be rejected at upload with a clear message, not when
 * someone later clicks it and gets "file is not a database" from the driver.
 */
export async function uploadDatabase(
  input: UploadDatabaseInput,
  deps: SqliteBrowserDeps,
): Promise<UploadedDatabase> {
  const parsed = uploadDatabaseSchema.parse(input);

  const storedFileName = await deps.fileStore.save(parsed.bytes, parsed.originalFileName);

  try {
    const filePath = deps.fileStore.pathFor(storedFileName);
    if (!(await deps.reader.isSqliteFile(filePath))) {
      throw new Error("That file is not a SQLite database.");
    }

    return deps.repo.create({
      originalFileName: parsed.originalFileName,
      storedFileName,
      byteSize: parsed.bytes.byteLength,
      uploadedByUserId: parsed.uploadedByUserId,
    });
  } catch (error) {
    await deps.fileStore.remove(storedFileName);
    throw error;
  }
}

/**
 * The tables inside one uploaded file.
 *
 * A row whose file has gone missing reports that rather than throwing the
 * driver's error: an upload root is a workspace and can legitimately be
 * cleared, and "the file is no longer on disk" is something the reader can act
 * on by uploading it again.
 */
export async function listTablesIn(
  databaseId: number,
  deps: SqliteBrowserDeps,
): Promise<BrowsedTable[]> {
  const filePath = await resolveFilePath(databaseId, deps);
  return deps.reader.listTables(filePath);
}

/** A capped read of one table inside one uploaded file. */
export async function readTableRows(
  input: ReadTableInput,
  deps: SqliteBrowserDeps,
): Promise<BrowsedPage> {
  const parsed = readTableSchema.parse(input);
  const filePath = await resolveFilePath(parsed.databaseId, deps);
  return deps.reader.readTable(filePath, parsed.tableName, parsed.limit);
}

/**
 * Deletes rows from a table inside an uploaded file.
 *
 * This writes to the uploaded file, which is the point of the screen — the
 * uploaded copy is a workspace, not the household's data. It can never reach
 * `myhomebase.db`: the path comes from the file store, keyed by the row's
 * stored name.
 */
export async function deleteRows(
  input: DeleteRowsInput,
  deps: SqliteBrowserDeps,
): Promise<DeleteRowsResult> {
  const parsed = deleteRowsSchema.parse(input);
  const filePath = await resolveFilePath(parsed.databaseId, deps);

  // Duplicates in the selection would inflate the reported count without
  // deleting anything extra, so they are collapsed before the delete runs.
  const uniqueRowIds = [...new Set(parsed.rowIds)];
  const deletedCount = deps.reader.deleteRows(filePath, parsed.tableName, uniqueRowIds);

  return { tableName: parsed.tableName, deletedCount };
}

/**
 * Forgets an uploaded file and removes it from disk.
 *
 * The row goes first here, the opposite of upload: if the unlink fails, a
 * stranded file in a workspace folder is harmless, whereas a row pointing at a
 * deleted file would be a picker entry that errors on every click.
 */
export async function deleteUploadedDatabase(
  databaseId: number,
  deps: SqliteBrowserDeps,
): Promise<boolean> {
  const record = deps.repo.getById(databaseId);
  if (!record) return false;

  deps.repo.delete(databaseId);
  await deps.fileStore.remove(record.storedFileName);
  return true;
}

/** The path of an upload's file, checked to still exist. */
async function resolveFilePath(databaseId: number, deps: SqliteBrowserDeps): Promise<string> {
  const record = deps.repo.getById(databaseId);
  if (!record) throw new Error("That uploaded database is no longer listed.");

  if (!(await deps.fileStore.exists(record.storedFileName))) {
    throw new Error(
      `The file for "${record.originalFileName}" is no longer on disk. Upload it again.`,
    );
  }

  return deps.fileStore.pathFor(record.storedFileName);
}
