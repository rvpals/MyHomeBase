"use server";

import { revalidatePath } from "next/cache";
import {
  CSV_PAGE_LIMIT,
  deleteCsvRows,
  deleteUploadedCsvFile,
  editCsvRows,
  readCsvRows,
  type CsvBrowsedPage,
  type CsvCellChanges,
  type CsvFileBrowserDeps,
} from "@/lib/csv-file-browser";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "../../require-access";

/** The module these actions belong to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "tools";

const CSV_BROWSER_PATH = "/modules/tools/csv-browser";

/** The three pieces every use-case here needs, assembled from the composition root. */
const browserDeps: CsvFileBrowserDeps = {
  repo: deps.uploadedCsvFileRepo,
  fileStore: deps.csvFileStore,
  tableStore: deps.csvTableStore,
};

export interface CsvActionResult {
  ok: boolean;
  error?: string;
}

function toErrorResult(error: unknown, fallback: string): CsvActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

// Uploading is NOT a server action. It goes to
// `src/app/api/tools/csv-browser/upload/route.ts`, for the same two reasons the
// SQLite browser's does: Next caps an action's body at
// `serverActions.bodySizeLimit` (4 MB), which is far below the module's own cap,
// and a route handler can stream the file to disk instead of buffering it.
//
// Exporting is not an action either — it streams a file back, which an action
// cannot do. See `api/tools/csv-browser/[id]/export/route.ts`.

export interface ReadCsvResult extends CsvActionResult {
  page?: CsvBrowsedPage;
}

/** A window of one uploaded file's rows. A read, and guarded like every other action. */
export async function readCsvRowsAction(
  fileId: number,
  offset: number,
): Promise<ReadCsvResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    // The limit is left to the schema's default, so the web app and the CLI
    // read the same number of rows.
    const page = await readCsvRows({ fileId, offset }, browserDeps);
    return { ok: true, page };
  } catch (error) {
    return toErrorResult(error, "Could not read that file.");
  }
}

export interface EditCsvResult extends CsvActionResult {
  updatedCount?: number;
  /** The file re-read after the edit, so the grid never shows a stale row. */
  page?: CsvBrowsedPage;
}

/**
 * Writes the same values to one or more rows, then re-reads the page.
 *
 * Both the single-row edit and the bulk edit call this — one is a selection of
 * one. Re-reading here rather than letting the client patch the row in place
 * keeps the grid honest about what is actually stored, which matters because a
 * cleared cell comes back as NULL rather than as the empty string that was
 * typed.
 *
 * `offset` is passed through so the re-read returns the page the reader is
 * looking at rather than jumping them back to the top.
 */
export async function editCsvRowsAction(
  fileId: number,
  rowIds: number[],
  changes: CsvCellChanges,
  offset: number,
): Promise<EditCsvResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);

    const result = await editCsvRows({ fileId, rowIds, changes }, browserDeps);
    const page = await readCsvRows({ fileId, offset }, browserDeps);

    revalidatePath(CSV_BROWSER_PATH);
    return { ok: true, updatedCount: result.updatedCount, page };
  } catch (error) {
    return toErrorResult(error, "Could not apply those changes.");
  }
}

export interface DeleteCsvResult extends CsvActionResult {
  deletedCount?: number;
  page?: CsvBrowsedPage;
}

/**
 * Deletes rows from an uploaded file, then re-reads the page.
 *
 * The offset is clamped by the use-case's own read: deleting the last rows of
 * the last page would otherwise leave the reader on a page past the end of the
 * file, looking at nothing.
 */
export async function deleteCsvRowsAction(
  fileId: number,
  rowIds: number[],
  offset: number,
): Promise<DeleteCsvResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);

    const result = await deleteCsvRows({ fileId, rowIds }, browserDeps);

    // Re-read at a clamped offset, so a delete that empties the last window
    // lands on the new last one rather than on an empty grid.
    const page = await readCsvRows(
      { fileId, offset: clampOffset(offset, result.remainingRows) },
      browserDeps,
    );

    revalidatePath(CSV_BROWSER_PATH);
    return { ok: true, deletedCount: result.deletedCount, page };
  } catch (error) {
    return toErrorResult(error, "Could not delete those rows.");
  }
}

/** Forgets an uploaded file and removes it and its sidecar from disk. */
export async function deleteCsvFileAction(fileId: number): Promise<CsvActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);

    const removed = await deleteUploadedCsvFile(fileId, browserDeps);
    if (!removed) return { ok: false, error: "That uploaded file is no longer listed." };

    revalidatePath(CSV_BROWSER_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not remove that file.");
  }
}

/**
 * The largest offset that still shows rows, rounded down to a window boundary.
 *
 * Presentation arithmetic, not a business rule — it decides which page to show
 * after a delete, which is a view concern. The library's read is happy to
 * return an empty window for an offset past the end; it is the reader staring
 * at an empty grid that is the problem.
 *
 * `CSV_PAGE_LIMIT` is the *server* window (how many rows one read returns), not
 * the grid's page size — the grid pages client-side within whatever comes back.
 */
function clampOffset(offset: number, remainingRows: number): number {
  if (offset < remainingRows) return offset;
  if (remainingRows === 0) return 0;

  return Math.floor((remainingRows - 1) / CSV_PAGE_LIMIT) * CSV_PAGE_LIMIT;
}
