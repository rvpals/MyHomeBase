"use server";

import { revalidatePath } from "next/cache";
import {
  deleteRows,
  deleteUploadedDatabase,
  listTablesIn,
  readTableRows,
  type BrowsedPage,
  type BrowsedTable,
  type SqliteBrowserDeps,
} from "@/lib/sqlite-browser";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "../../require-access";

/** The module these actions belong to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "tools";

const SQLITE_BROWSER_PATH = "/modules/tools/sqlite-browser";

/** The three pieces every use-case here needs, assembled from the composition root. */
const browserDeps: SqliteBrowserDeps = {
  repo: deps.uploadedDatabaseRepo,
  fileStore: deps.sqliteFileStore,
  reader: deps.foreignDatabaseReader,
};

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function toErrorResult(error: unknown, fallback: string): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

// Uploading is NOT a server action. It goes to
// `src/app/api/tools/sqlite-browser/upload/route.ts`, because Next caps an
// action's body at `serverActions.bodySizeLimit` (4 MB) — which made the
// module's own 50 MB cap unreachable — and because a route handler can stream
// the file to disk instead of buffering it whole.

export interface ListTablesResult extends ActionResult {
  tables?: BrowsedTable[];
}

/** The tables inside one uploaded file. A read, and guarded like every other action. */
export async function listTablesAction(databaseId: number): Promise<ListTablesResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    return { ok: true, tables: await listTablesIn(databaseId, browserDeps) };
  } catch (error) {
    return toErrorResult(error, "Could not read that database.");
  }
}

export interface ReadTableResult extends ActionResult {
  page?: BrowsedPage;
}

/** A capped read of one table. */
export async function readTableAction(
  databaseId: number,
  tableName: string,
): Promise<ReadTableResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    // The limit is left to the schema's default, so the web app and the CLI
    // read the same number of rows.
    const page = await readTableRows({ databaseId, tableName }, browserDeps);
    return { ok: true, page };
  } catch (error) {
    return toErrorResult(error, "Could not read that table.");
  }
}

export interface DeleteRowsResultPayload extends ActionResult {
  deletedCount?: number;
  /** The table re-read after the delete, so the grid never shows a stale row. */
  page?: BrowsedPage;
}

/**
 * Deletes rows from a table inside an uploaded file, then re-reads it.
 *
 * Both the single-row button and the bulk action call this — one is a list of
 * one. Re-reading here rather than letting the client splice the row out keeps
 * the grid honest about what is actually in the file.
 */
export async function deleteRowsAction(
  databaseId: number,
  tableName: string,
  rowIds: number[],
): Promise<DeleteRowsResultPayload> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);

    const result = await deleteRows({ databaseId, tableName, rowIds }, browserDeps);
    const page = await readTableRows({ databaseId, tableName }, browserDeps);

    revalidatePath(SQLITE_BROWSER_PATH);
    return { ok: true, deletedCount: result.deletedCount, page };
  } catch (error) {
    return toErrorResult(error, "Could not delete those rows.");
  }
}

/** Forgets an uploaded file and removes it from disk. */
export async function deleteDatabaseAction(databaseId: number): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);

    const removed = await deleteUploadedDatabase(databaseId, browserDeps);
    if (!removed) return { ok: false, error: "That uploaded database is no longer listed." };

    revalidatePath(SQLITE_BROWSER_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not remove that database.");
  }
}
