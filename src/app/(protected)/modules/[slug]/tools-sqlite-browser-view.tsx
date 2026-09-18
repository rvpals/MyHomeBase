"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/button";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { FileDropzone } from "@/components/file-dropzone";
import { Modal } from "@/components/modal";
import type { BrowsedPage, BrowsedRow, BrowsedTable, UploadedDatabase } from "@/lib/sqlite-browser";
import {
  deleteDatabaseAction,
  deleteRowsAction,
  listTablesAction,
  readTableAction,
  uploadDatabaseAction,
} from "./tools-actions";

/**
 * The SQLite File Browser.
 *
 * Three steps down the screen: pick (or upload) a file, pick a table, work with
 * the rows. Everything below the fold is driven by server actions — the view
 * holds only which file and table are open and what has come back.
 *
 * Narrow: the file list and the table list are `max-lg:` stacked above the grid
 * instead of sitting beside it, and `DataGrid` swaps itself for `DataGridCompact`
 * below 1024px, carrying the checkboxes and the bulk action with it.
 */
export function ToolsSqliteBrowserView({ databases }: { databases: UploadedDatabase[] }) {
  const [openDatabase, setOpenDatabase] = useState<UploadedDatabase | undefined>();
  const [tables, setTables] = useState<BrowsedTable[]>([]);
  const [page, setPage] = useState<BrowsedPage | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();
  const [isUploading, setIsUploading] = useState(false);
  const [confirmRows, setConfirmRows] = useState<
    { rowIds: number[]; clearSelection?: () => void } | undefined
  >();
  const [confirmRemoveFile, setConfirmRemoveFile] = useState<UploadedDatabase | undefined>();

  const isBusy = isPending || isUploading;

  const openTable = useCallback(
    (databaseId: number, tableName: string) => {
      setError(undefined);
      startTransition(async () => {
        const result = await readTableAction(databaseId, tableName);
        if (!result.ok || !result.page) {
          setError(result.error ?? "Could not read that table.");
          return;
        }
        setPage(result.page);
      });
    },
    [],
  );

  const openDatabaseById = useCallback((database: UploadedDatabase) => {
    setError(undefined);
    setNotice(undefined);
    setPage(undefined);
    setOpenDatabase(database);
    startTransition(async () => {
      const result = await listTablesAction(database.id);
      if (!result.ok || !result.tables) {
        setTables([]);
        setError(result.error ?? "Could not read that database.");
        return;
      }
      setTables(result.tables);
    });
  }, []);

  async function handleUpload(file: File) {
    setError(undefined);
    setNotice(undefined);
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const result = await uploadDatabaseAction(formData);
      if (!result.ok) {
        setError(result.error ?? "Could not upload that file.");
        return;
      }
      setNotice(`Uploaded ${file.name}. Pick it below to browse it.`);
    } finally {
      setIsUploading(false);
    }
  }

  function runRowDelete(rowIds: number[], clearSelection?: () => void) {
    if (!openDatabase || !page) return;
    const tableName = page.tableName;

    startTransition(async () => {
      const result = await deleteRowsAction(openDatabase.id, tableName, rowIds);
      setConfirmRows(undefined);
      if (!result.ok || !result.page) {
        setError(result.error ?? "Could not delete those rows.");
        return;
      }
      clearSelection?.();
      setPage(result.page);
      setNotice(
        `Deleted ${result.deletedCount} ${result.deletedCount === 1 ? "row" : "rows"} from ${tableName}.`,
      );
      // The row counts in the table list are now stale, so they are re-read
      // rather than adjusted by hand — a delete can cascade in the uploaded
      // file, so "one fewer" is not reliably the right answer.
      const refreshed = await listTablesAction(openDatabase.id);
      if (refreshed.ok && refreshed.tables) setTables(refreshed.tables);
    });
  }

  function runRemoveFile(database: UploadedDatabase) {
    startTransition(async () => {
      const result = await deleteDatabaseAction(database.id);
      setConfirmRemoveFile(undefined);
      if (!result.ok) {
        setError(result.error ?? "Could not remove that database.");
        return;
      }
      if (openDatabase?.id === database.id) {
        setOpenDatabase(undefined);
        setTables([]);
        setPage(undefined);
      }
      setNotice(`Removed ${database.originalFileName}.`);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <FileDropzone
        accept=".db,.sqlite,.sqlite3,.db3"
        label={
          isUploading
            ? "Uploading…"
            : "Drop a SQLite file here, or click to browse (.db, .sqlite, .sqlite3, .db3 — up to 50 MB)"
        }
        disabled={isBusy}
        onFile={(file) => void handleUpload(file)}
      />

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      {notice && !error && (
        <p className="text-sm text-muted">
          {notice}
        </p>
      )}

      {/* Files beside tables on a wide screen, stacked on a narrow one. */}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 max-lg:grid-cols-1">
        <UploadedFileList
          databases={databases}
          openDatabaseId={openDatabase?.id}
          isBusy={isBusy}
          onOpen={openDatabaseById}
          onRemove={setConfirmRemoveFile}
        />

        {openDatabase && (
          <TableList
            tables={tables}
            openTableName={page?.tableName}
            isBusy={isBusy}
            onOpen={(tableName) => openTable(openDatabase.id, tableName)}
          />
        )}
      </div>

      {page && (
        <TableGrid
          page={page}
          isBusy={isBusy}
          onDeleteRows={(rowIds, clearSelection) => setConfirmRows({ rowIds, clearSelection })}
        />
      )}

      {confirmRows && (
        <Modal
          title="Delete these rows?"
          description="They are removed from the uploaded file immediately. This cannot be undone."
          onClose={() => setConfirmRows(undefined)}
          isBusy={isBusy}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmRows(undefined)} disabled={isBusy}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={isBusy}
                onClick={() => runRowDelete(confirmRows.rowIds, confirmRows.clearSelection)}
              >
                {isBusy ? "Working…" : "Delete"}
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink">
            {confirmRows.rowIds.length} {confirmRows.rowIds.length === 1 ? "row" : "rows"} selected
            from <span className="font-mono">{page?.tableName}</span>.
          </p>
        </Modal>
      )}

      {confirmRemoveFile && (
        <Modal
          title="Remove this database?"
          description="The uploaded copy is deleted from the server. Your original file is untouched."
          onClose={() => setConfirmRemoveFile(undefined)}
          isBusy={isBusy}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => setConfirmRemoveFile(undefined)}
                disabled={isBusy}
              >
                Cancel
              </Button>
              <Button variant="danger" disabled={isBusy} onClick={() => runRemoveFile(confirmRemoveFile)}>
                {isBusy ? "Working…" : "Remove"}
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink">{confirmRemoveFile.originalFileName}</p>
        </Modal>
      )}
    </div>
  );
}

/** The uploaded files, newest first. */
function UploadedFileList({
  databases,
  openDatabaseId,
  isBusy,
  onOpen,
  onRemove,
}: {
  databases: UploadedDatabase[];
  openDatabaseId: number | undefined;
  isBusy: boolean;
  onOpen: (database: UploadedDatabase) => void;
  onRemove: (database: UploadedDatabase) => void;
}) {
  return (
    <section className="rounded-lg border border-line bg-paper-raised p-3">
      <h2 className="font-display text-base text-ink">Uploaded files</h2>
      {databases.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Nothing uploaded yet.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {databases.map((database) => (
            <li key={database.id} className="flex items-center gap-2">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => onOpen(database)}
                className={`flex-1 rounded px-2 py-1.5 text-left text-sm transition-colors disabled:opacity-60 ${
                  database.id === openDatabaseId
                    ? "bg-brass-soft font-medium text-brass-dark"
                    : "text-ink hover:bg-line/60"
                }`}
              >
                <span className="font-medium">{database.originalFileName}</span>
                <span className="block text-xs text-muted">
                  {formatBytes(database.byteSize)} · {database.uploadedByName ?? "Unknown"}
                </span>
              </button>
              <Button
                size="sm"
                variant="secondary"
                disabled={isBusy}
                onClick={() => onRemove(database)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The tables and views inside the open file. */
function TableList({
  tables,
  openTableName,
  isBusy,
  onOpen,
}: {
  tables: BrowsedTable[];
  openTableName: string | undefined;
  isBusy: boolean;
  onOpen: (tableName: string) => void;
}) {
  return (
    <section className="rounded-lg border border-line bg-paper-raised p-3">
      <h2 className="font-display text-base text-ink">Tables</h2>
      {tables.length === 0 ? (
        <p className="mt-2 text-sm text-muted">
          {isBusy ? "Reading…" : "That file holds no tables."}
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {tables.map((table) => (
            <li key={table.name}>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => onOpen(table.name)}
                className={`w-full rounded px-2 py-1.5 text-left text-sm transition-colors disabled:opacity-60 ${
                  table.name === openTableName
                    ? "bg-brass-soft font-medium text-brass-dark"
                    : "text-ink hover:bg-line/60"
                }`}
              >
                <span className="font-mono">{table.name}</span>
                <span className="block text-xs text-muted">
                  {table.rowCount.toLocaleString()} {table.rowCount === 1 ? "row" : "rows"}
                  {!table.canDelete && " · read-only"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A browsed row plus the stable key the grid identifies it by. */
type KeyedRow = BrowsedRow & { key: number | string };

/** The open table's rows. */
function TableGrid({
  page,
  isBusy,
  onDeleteRows,
}: {
  page: BrowsedPage;
  isBusy: boolean;
  onDeleteRows: (rowIds: number[], clearSelection?: () => void) => void;
}) {
  // Columns are the uploaded table's own, so they are built per page rather than
  // declared: this grid renders an arbitrary schema, like CSV Analysis's does.
  // Every column gets `value`, which is what opts it into sort, search, the
  // per-column filters and CSV export — the grid gives all of that for free once
  // the raw primitive is supplied.
  // A stable key per row. The rowid is the right one — the grid sorts and
  // filters, so a positional key would address the wrong row the moment either
  // is used. A view has no rowid, so those fall back to their original position,
  // which is stable because the rows array is never reordered in place.
  const rows = useMemo<KeyedRow[]>(
    () => page.rows.map((row, index) => ({ ...row, key: row.rowId ?? `row-${index}` })),
    [page.rows],
  );

  const columns = useMemo<DataGridColumn<KeyedRow>[]>(() => {
    const cells: DataGridColumn<KeyedRow>[] = page.columns.map((column, index) => ({
      key: column,
      header: column,
      render: (row) => renderCell(row.cells[index]),
      value: (row) => {
        const cell = row.cells[index];
        return cell === null ? "" : cell;
      },
    }));

    if (!page.canDelete) return cells;

    return [
      ...cells,
      {
        key: "__actions",
        header: "Actions",
        // Kept out of the record modal: a row's Delete button is not part of a
        // read-out of the record.
        excludeFromRecordView: true,
        render: (row) =>
          row.rowId === undefined ? null : (
            <Button
              size="sm"
              variant="danger"
              disabled={isBusy}
              onClick={() => onDeleteRows([row.rowId as number])}
            >
              Delete
            </Button>
          ),
      },
    ];
  }, [page.columns, page.canDelete, isBusy, onDeleteRows]);

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-base text-ink">
          <span className="font-mono">{page.tableName}</span>
        </h2>
        <p className="text-sm text-muted">
          {page.returnedRows < page.totalRows
            ? `Showing the first ${page.returnedRows.toLocaleString()} of ${page.totalRows.toLocaleString()} rows.`
            : `${page.totalRows.toLocaleString()} ${page.totalRows === 1 ? "row" : "rows"}.`}
          {!page.canDelete && " Rows here cannot be deleted individually."}
        </p>
      </div>

      <DataGrid
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.key}
        emptyMessage="That table has no rows."
        exportFileName={page.tableName}
        storageKey={`tools-sqlite-browser-${page.tableName}`}
        enableSelection={page.canDelete}
        renderSelectionActions={
          page.canDelete
            ? (selectedRows, clearSelection) => (
                <Button
                  size="sm"
                  variant="danger"
                  disabled={isBusy}
                  onClick={() =>
                    onDeleteRows(
                      selectedRows
                        .map((row) => row.rowId)
                        .filter((rowId): rowId is number => rowId !== undefined),
                      clearSelection,
                    )
                  }
                >
                  Delete selected
                </Button>
              )
            : undefined
        }
      />
    </section>
  );
}

/** A NULL reads as an explicit marker, so it can't be mistaken for an empty string. */
function renderCell(cell: BrowsedRow["cells"][number]) {
  if (cell === null) return <span className="text-muted">NULL</span>;
  return <span className="font-mono text-xs">{String(cell)}</span>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
