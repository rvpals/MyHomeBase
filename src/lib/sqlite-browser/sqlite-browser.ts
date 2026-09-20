import {
  listModuleSettingsFor,
  type ModuleSettingsRepository,
} from "@/lib/module-settings";
import { getModuleBySlug, type ModuleRepository } from "@/lib/modules";
import type { ForeignDatabaseReader, SqliteFileStore, UploadedDatabaseRepository } from "./ports";
import { TOOLS_MODULE_SLUG, resolveToolsSettings } from "./settings";
import {
  DEFAULT_MAX_UPLOAD_BYTES,
  deleteRowsSchema,
  readTableSchema,
  uploadDatabaseSchemaFor,
  uploadFileNameSchema,
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

/**
 * The configured upload cap, read from storage.
 *
 * The one call every upload path makes, so the web route and the CLI can
 * never disagree about the limit. A module row that is somehow missing
 * resolves to the default rather than throwing: the cap is a guard rail, and
 * failing every upload because a registry row is absent would be worse than
 * applying the shipped figure.
 *
 * Lives here rather than in `settings.ts` so that file stays free of
 * repository imports — the admin's client-side control imports it directly,
 * and a transitive `better-sqlite3` would break the browser bundle.
 */
export function getMaxUploadBytes(
  moduleRepo: ModuleRepository,
  settingsRepo: ModuleSettingsRepository,
): number {
  const appModule = getModuleBySlug(moduleRepo, TOOLS_MODULE_SLUG);
  if (!appModule) return DEFAULT_MAX_UPLOAD_BYTES;

  return resolveToolsSettings(listModuleSettingsFor(settingsRepo, appModule.id)).maxUploadBytes;
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
  maxBytes: number = DEFAULT_MAX_UPLOAD_BYTES,
): Promise<UploadedDatabase> {
  const parsed = uploadDatabaseSchemaFor(maxBytes).parse(input);

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
 * The same, from a stream — what the upload route calls.
 *
 * Identical rules to `uploadDatabase` (bytes first, header-checked before the
 * row, file removed if anything fails); it differs only in never holding the
 * whole file in memory. A Server Action cannot be used for this at all: Next
 * caps an action's body at `serverActions.bodySizeLimit`, and raising that to
 * 50 MB would apply to every action in the app *and* buffer each upload
 * whole. The cap here is enforced by the store as the stream arrives.
 *
 * The name is validated on its own before a byte is written, so a `.csv`
 * is refused without being spooled to disk first.
 */
export async function uploadDatabaseStream(
  input: {
    originalFileName: string;
    stream: ReadableStream<Uint8Array>;
    uploadedByUserId: number | null;
  },
  deps: SqliteBrowserDeps,
  maxBytes: number = DEFAULT_MAX_UPLOAD_BYTES,
): Promise<UploadedDatabase> {
  const originalFileName = uploadFileNameSchema.parse(input.originalFileName);

  const { storedFileName, byteSize } = await deps.fileStore.saveStream(
    input.stream,
    originalFileName,
    maxBytes,
  );

  try {
    const filePath = deps.fileStore.pathFor(storedFileName);
    if (!(await deps.reader.isSqliteFile(filePath))) {
      throw new Error("That file is not a SQLite database.");
    }

    return deps.repo.create({
      originalFileName,
      storedFileName,
      byteSize,
      uploadedByUserId: input.uploadedByUserId,
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
