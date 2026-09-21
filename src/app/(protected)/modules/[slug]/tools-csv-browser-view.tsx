"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/button";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { FileDropzone } from "@/components/file-dropzone";
import { Modal } from "@/components/modal";
// From the leaf modules, not the barrel: the barrel re-exports the repository,
// the file store and the table store, which pull in `better-sqlite3`/`node:fs`
// and cannot be bundled for a browser. These two files are pure. The types are
// erased at compile time, so importing those from the barrel is free.
import {
  CSV_DELIMITERS,
  DELIMITER_LABELS,
  type CsvDelimiter,
} from "@/lib/csv-file-browser/delimiter";
import { formatCap } from "@/lib/csv-file-browser/errors";
// The real window size, not a copy: the pager steps by exactly what one server
// read returns, and a second literal here would silently skip or repeat rows
// the day the limit changed. `schema.ts` is pure zod, so it bundles fine.
import { CSV_PAGE_LIMIT } from "@/lib/csv-file-browser/schema";
import type {
  CsvBrowsedPage,
  CsvBrowsedRow,
  CsvCellChanges,
  UploadedCsvFile,
} from "@/lib/csv-file-browser";
import {
  deleteCsvFileAction,
  deleteCsvRowsAction,
  editCsvRowsAction,
  readCsvRowsAction,
} from "./tools-csv-actions";

/** The streaming upload endpoint — see the comment in `handleUpload`. */
const UPLOAD_ENDPOINT = "/api/tools/csv-browser/upload";

/**
 * The CSV File Browser.
 *
 * Two steps down the screen: pick (or upload) a file, then work with its rows.
 * One step fewer than the SQLite browser, which needs a table picked first — a
 * delimited file is one table by definition.
 *
 * Everything below the dropzone is driven by server actions; the view holds
 * only which file is open, which server window it is showing, and what has
 * come back.
 *
 * Narrow: the file list is `max-lg:` stacked above the grid instead of sitting
 * beside it, the import options wrap to one control per line, and `DataGrid`
 * swaps itself for `DataGridCompact` below 1024px, carrying the checkboxes and
 * the bulk actions with it.
 */
export function ToolsCsvBrowserView({
  files,
  maxUploadBytes,
}: {
  files: UploadedCsvFile[];
  /** The configured cap, resolved on the server — see Admin → Configuration. */
  maxUploadBytes: number;
}) {
  const [openFile, setOpenFile] = useState<UploadedCsvFile | undefined>();
  const [page, setPage] = useState<CsvBrowsedPage | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();
  const [isUploading, setIsUploading] = useState(false);

  // The import overrides. Left alone they mean "work it out for me" — the
  // delimiter is sniffed server-side and a header row assumed. They are read at
  // the moment of upload, so changing them affects the next file, not the open
  // one: a file's delimiter is fixed once its rows are loaded.
  const [delimiter, setDelimiter] = useState<CsvDelimiter | "auto">("auto");
  const [hasHeaderRow, setHasHeaderRow] = useState(true);

  const [editRow, setEditRow] = useState<CsvBrowsedRow | undefined>();
  const [bulkEditRows, setBulkEditRows] = useState<
    { rowIds: number[]; clearSelection?: () => void } | undefined
  >();
  const [confirmRows, setConfirmRows] = useState<
    { rowIds: number[]; clearSelection?: () => void } | undefined
  >();
  const [confirmRemoveFile, setConfirmRemoveFile] = useState<UploadedCsvFile | undefined>();
  const router = useRouter();

  const isBusy = isPending || isUploading;

  const openFileById = useCallback((file: UploadedCsvFile) => {
    setError(undefined);
    setNotice(undefined);
    setPage(undefined);
    setOpenFile(file);
    startTransition(async () => {
      const result = await readCsvRowsAction(file.id, 0);
      if (!result.ok || !result.page) {
        setError(result.error ?? "Could not read that file.");
        return;
      }
      setPage(result.page);
    });
  }, []);

  /** Moves to another server window of the same file. */
  const showWindow = useCallback(
    (offset: number) => {
      if (!openFile) return;
      setError(undefined);
      startTransition(async () => {
        const result = await readCsvRowsAction(openFile.id, offset);
        if (!result.ok || !result.page) {
          setError(result.error ?? "Could not read that file.");
          return;
        }
        setPage(result.page);
      });
    },
    [openFile],
  );

  async function handleUpload(file: File) {
    setError(undefined);
    setNotice(undefined);

    // Checked here as well as on the server, purely to save the reader's time:
    // the browser already knows the size, so there is no reason to push a
    // gigabyte up the wire before being told it is too big. The server check
    // is the one that counts — this one is a courtesy and is trivially
    // bypassed.
    if (file.size > maxUploadBytes) {
      // `formatBytes` for the file (exact, e.g. "1.4 MB") and `formatCap` for
      // the limit (round, e.g. "1 GB") — each reads the way its number is meant.
      setError(
        `${file.name} is ${formatBytes(file.size)}, over the ${formatCap(maxUploadBytes)} limit.`,
      );
      return;
    }

    setIsUploading(true);
    try {
      // Posted to a route handler, not a server action: an action's body is
      // capped at 4 MB (next.config.ts), and the file is sent as the raw
      // request body so the server can stream it to disk without buffering.
      // The name and the import options ride in headers for the same reason —
      // a multipart body would have to be parsed to reach them.
      const headers: Record<string, string> = {
        "x-upload-filename": encodeURIComponent(file.name),
        "x-upload-header-row": hasHeaderRow ? "1" : "0",
      };
      // A raw tab is not legal in a header value, hence the encoding.
      if (delimiter !== "auto") headers["x-upload-delimiter"] = encodeURIComponent(delimiter);

      const response = await fetch(UPLOAD_ENDPOINT, { method: "POST", headers, body: file });

      const result = (await response.json().catch(() => undefined)) as
        | { ok?: boolean; error?: string }
        | undefined;

      if (!response.ok || !result?.ok) {
        setError(result?.error ?? "Could not upload that file.");
        return;
      }

      setNotice(`Uploaded ${file.name}. Pick it below to work on it.`);
      // The list is server-rendered, so the new file only appears after the
      // route's data is refetched.
      router.refresh();
    } catch {
      setError("Could not reach the server to upload that file.");
    } finally {
      setIsUploading(false);
    }
  }

  function runEdit(rowIds: number[], changes: CsvCellChanges, clearSelection?: () => void) {
    if (!openFile || !page) return;
    const offset = page.offset;

    startTransition(async () => {
      const result = await editCsvRowsAction(openFile.id, rowIds, changes, offset);
      setEditRow(undefined);
      setBulkEditRows(undefined);
      if (!result.ok || !result.page) {
        setError(result.error ?? "Could not apply those changes.");
        return;
      }
      clearSelection?.();
      setPage(result.page);
      const count = result.updatedCount ?? 0;
      setNotice(`Updated ${count} ${count === 1 ? "row" : "rows"}.`);
    });
  }

  function runRowDelete(rowIds: number[], clearSelection?: () => void) {
    if (!openFile || !page) return;
    const offset = page.offset;

    startTransition(async () => {
      const result = await deleteCsvRowsAction(openFile.id, rowIds, offset);
      setConfirmRows(undefined);
      if (!result.ok || !result.page) {
        setError(result.error ?? "Could not delete those rows.");
        return;
      }
      clearSelection?.();
      setPage(result.page);
      const count = result.deletedCount ?? 0;
      setNotice(`Deleted ${count} ${count === 1 ? "row" : "rows"}.`);
      // The row count in the file list is now stale. It is server-rendered, so
      // a refetch is what corrects it.
      router.refresh();
    });
  }

  function runRemoveFile(file: UploadedCsvFile) {
    startTransition(async () => {
      const result = await deleteCsvFileAction(file.id);
      setConfirmRemoveFile(undefined);
      if (!result.ok) {
        setError(result.error ?? "Could not remove that file.");
        return;
      }
      if (openFile?.id === file.id) {
        setOpenFile(undefined);
        setPage(undefined);
      }
      setNotice(`Removed ${file.originalFileName}.`);
      // Same reason as after an upload: the list is server-rendered, so the
      // removed file lingers on screen until the route's data is refetched.
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <FileDropzone
        accept=".csv,.txt,.tsv,.tab,.psv"
        label={
          isUploading
            ? "Uploading…"
            : `Drop a CSV or text file here, or click to browse (.csv, .txt, .tsv, .tab, .psv — up to ${formatCap(maxUploadBytes)})`
        }
        disabled={isBusy}
        onFile={(file) => void handleUpload(file)}
      />

      <ImportOptions
        delimiter={delimiter}
        hasHeaderRow={hasHeaderRow}
        isBusy={isBusy}
        onDelimiterChange={setDelimiter}
        onHeaderRowChange={setHasHeaderRow}
      />

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      {notice && !error && <p className="text-sm text-muted">{notice}</p>}

      <UploadedFileList
        files={files}
        openFileId={openFile?.id}
        isBusy={isBusy}
        onOpen={openFileById}
        onRemove={setConfirmRemoveFile}
      />

      {openFile && page && (
        <RowGrid
          file={openFile}
          page={page}
          isBusy={isBusy}
          onEditRow={setEditRow}
          onBulkEdit={(rowIds, clearSelection) => setBulkEditRows({ rowIds, clearSelection })}
          onDeleteRows={(rowIds, clearSelection) => setConfirmRows({ rowIds, clearSelection })}
          onShowWindow={showWindow}
        />
      )}

      {openFile && editRow && page && (
        <EditRowDialog
          columns={page.columns}
          row={editRow}
          isBusy={isBusy}
          onCancel={() => setEditRow(undefined)}
          onApply={(changes) => runEdit([editRow.rowId], changes)}
        />
      )}

      {openFile && bulkEditRows && page && (
        <BulkEditDialog
          columns={page.columns}
          rowCount={bulkEditRows.rowIds.length}
          isBusy={isBusy}
          onCancel={() => setBulkEditRows(undefined)}
          onApply={(changes) =>
            runEdit(bulkEditRows.rowIds, changes, bulkEditRows.clearSelection)
          }
        />
      )}

      {confirmRows && (
        <Modal
          title="Delete these rows?"
          description="They are removed from the uploaded copy immediately. This cannot be undone."
          onClose={() => setConfirmRows(undefined)}
          isBusy={isBusy}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => setConfirmRows(undefined)}
                disabled={isBusy}
              >
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
            from <span className="font-mono">{openFile?.originalFileName}</span>.
          </p>
        </Modal>
      )}

      {confirmRemoveFile && (
        <Modal
          title="Remove this file?"
          description="The uploaded copy and all edits made to it are deleted from the server. Your original file is untouched."
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
              <Button
                variant="danger"
                disabled={isBusy}
                onClick={() => runRemoveFile(confirmRemoveFile)}
              >
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

const CONTROL_CLASS =
  "rounded-md border border-line bg-paper px-2 py-1 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass disabled:opacity-40";

/**
 * How the *next* upload is read.
 *
 * Above the file list rather than inside a per-file menu because that is when
 * they apply: a file's delimiter and header row are fixed once its rows are
 * loaded into the sidecar, so these are settings for the upload about to
 * happen, not properties of one already done.
 */
function ImportOptions({
  delimiter,
  hasHeaderRow,
  isBusy,
  onDelimiterChange,
  onHeaderRowChange,
}: {
  delimiter: CsvDelimiter | "auto";
  hasHeaderRow: boolean;
  isBusy: boolean;
  onDelimiterChange: (value: CsvDelimiter | "auto") => void;
  onHeaderRowChange: (value: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 max-lg:flex-col max-lg:items-start max-lg:gap-2">
      <label className="flex items-center gap-2 text-sm text-ink">
        Separator
        <select
          className={CONTROL_CLASS}
          value={delimiter}
          disabled={isBusy}
          onChange={(event) => onDelimiterChange(event.target.value as CsvDelimiter | "auto")}
        >
          <option value="auto">Detect automatically</option>
          {CSV_DELIMITERS.map((candidate) => (
            <option key={candidate} value={candidate}>
              {DELIMITER_LABELS[candidate]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={hasHeaderRow}
          disabled={isBusy}
          onChange={(event) => onHeaderRowChange(event.target.checked)}
          className="h-4 w-4 rounded border-line text-brass disabled:opacity-40"
        />
        First row holds the column names
      </label>

      <p className="text-xs text-muted">Applies to the next file you upload.</p>
    </div>
  );
}

/** The uploaded files, newest first. */
function UploadedFileList({
  files,
  openFileId,
  isBusy,
  onOpen,
  onRemove,
}: {
  files: UploadedCsvFile[];
  openFileId: number | undefined;
  isBusy: boolean;
  onOpen: (file: UploadedCsvFile) => void;
  onRemove: (file: UploadedCsvFile) => void;
}) {
  return (
    <section className="rounded-lg border border-line bg-paper-raised p-3">
      <h2 className="font-display text-base text-ink">Uploaded files</h2>
      {files.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Nothing uploaded yet.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {files.map((file) => (
            <li key={file.id} className="flex items-center gap-2">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => onOpen(file)}
                className={`flex-1 rounded px-2 py-1.5 text-left text-sm transition-colors disabled:opacity-60 ${
                  file.id === openFileId
                    ? "bg-brass-soft font-medium text-brass-dark"
                    : "text-ink hover:bg-line/60"
                }`}
              >
                <span className="font-medium">{file.originalFileName}</span>
                <span className="block text-xs text-muted">
                  {file.rowCount.toLocaleString()} {file.rowCount === 1 ? "row" : "rows"} ·{" "}
                  {file.columnNames.length} {file.columnNames.length === 1 ? "column" : "columns"} ·{" "}
                  {DELIMITER_LABELS[file.delimiter].toLowerCase()}-separated ·{" "}
                  {formatBytes(file.byteSize)} · {file.uploadedByName ?? "Unknown"}
                </span>
              </button>
              <Button size="sm" variant="secondary" href={exportHref(file.id)}>
                Export
              </Button>
              <Button size="sm" variant="secondary" disabled={isBusy} onClick={() => onRemove(file)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A browsed row plus the stable key the grid identifies it by. */
type KeyedRow = CsvBrowsedRow & { key: number };

/** The open file's rows. */
function RowGrid({
  file,
  page,
  isBusy,
  onEditRow,
  onBulkEdit,
  onDeleteRows,
  onShowWindow,
}: {
  file: UploadedCsvFile;
  page: CsvBrowsedPage;
  isBusy: boolean;
  onEditRow: (row: CsvBrowsedRow) => void;
  onBulkEdit: (rowIds: number[], clearSelection?: () => void) => void;
  onDeleteRows: (rowIds: number[], clearSelection?: () => void) => void;
  onShowWindow: (offset: number) => void;
}) {
  // A stable key per row. The sidecar's rowid is the right one — the grid sorts
  // and filters, so a positional key would address the wrong row the moment
  // either is used, and it is also what every edit and delete is sent as.
  const rows = useMemo<KeyedRow[]>(
    () => page.rows.map((row) => ({ ...row, key: row.rowId })),
    [page.rows],
  );

  // Columns are the uploaded file's own, so they are built per page rather than
  // declared: this grid renders an arbitrary schema, like CSV Analysis's does.
  // Every column gets `value`, which is what opts it into sort, search, the
  // per-column filters and CSV export — the grid gives all of that for free
  // once the raw primitive is supplied.
  const columns = useMemo<DataGridColumn<KeyedRow>[]>(() => {
    const cells: DataGridColumn<KeyedRow>[] = page.columns.map((column, index) => ({
      key: `${index}:${column}`,
      header: column,
      render: (row) => renderCell(row.cells[index]),
      value: (row) => row.cells[index] ?? "",
    }));

    return [
      ...cells,
      {
        key: "__actions",
        header: "Actions",
        // Kept out of the record modal: a row's Edit/Delete buttons are not
        // part of a read-out of the record.
        excludeFromRecordView: true,
        render: (row) => (
          <span className="flex gap-1">
            <Button size="sm" variant="secondary" disabled={isBusy} onClick={() => onEditRow(row)}>
              Edit
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={isBusy}
              onClick={() => onDeleteRows([row.rowId])}
            >
              Delete
            </Button>
          </span>
        ),
      },
    ];
  }, [page.columns, isBusy, onEditRow, onDeleteRows]);

  const windowEnd = page.offset + page.returnedRows;
  const hasMore = windowEnd < page.totalRows;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-base text-ink">
          <span className="font-mono">{file.originalFileName}</span>
        </h2>
        <p className="text-sm text-muted">
          {page.totalRows === 0
            ? "No rows left."
            : `Rows ${(page.offset + 1).toLocaleString()}–${windowEnd.toLocaleString()} of ${page.totalRows.toLocaleString()}.`}
        </p>
      </div>

      <DataGrid
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.key}
        emptyMessage="That file has no rows."
        exportFileName={file.originalFileName.replace(/\.[^.]+$/, "")}
        storageKey={`tools-csv-browser-${file.id}`}
        enableSelection
        renderSelectionActions={(selectedRows, clearSelection) => {
          const rowIds = selectedRows.map((row) => row.rowId);
          return (
            <>
              <Button
                size="sm"
                variant="secondary"
                disabled={isBusy}
                onClick={() => onBulkEdit(rowIds, clearSelection)}
              >
                Bulk edit
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={isBusy}
                onClick={() => onDeleteRows(rowIds, clearSelection)}
              >
                Delete selected
              </Button>
            </>
          );
        }}
      />

      {/*
        The grid pages within one server window; this moves between windows.
        Two levels rather than one because the alternatives are both worse:
        sending a million rows to the browser so the grid can page them all, or
        making every in-grid page turn a round trip and losing client-side sort
        and filter across the set. It only appears when a file is big enough to
        need it.
      */}
      {(page.offset > 0 || hasMore) && (
        <div className="flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={isBusy || page.offset === 0}
            onClick={() => onShowWindow(Math.max(0, page.offset - CSV_PAGE_LIMIT))}
          >
            Previous {CSV_PAGE_LIMIT.toLocaleString()}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={isBusy || !hasMore}
            onClick={() => onShowWindow(page.offset + CSV_PAGE_LIMIT)}
          >
            Next {CSV_PAGE_LIMIT.toLocaleString()}
          </Button>
        </div>
      )}
    </section>
  );
}

const DIALOG_INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass disabled:opacity-40";

/**
 * Edits one row, every column at once.
 *
 * Local to this view rather than a shared component, exactly as CSV Analysis's
 * and Expense's dialogs are: the field list is *derived from the uploaded
 * file's own columns*, which no other grid can reuse. Promote it if a third
 * grid needs the same shape.
 *
 * Only the columns that actually changed are sent. The alternative — sending
 * every column every time — would overwrite a cell another reader edited while
 * this dialog was open, for no benefit.
 */
function EditRowDialog({
  columns,
  row,
  isBusy,
  onCancel,
  onApply,
}: {
  columns: string[];
  row: CsvBrowsedRow;
  isBusy: boolean;
  onCancel: () => void;
  onApply: (changes: CsvCellChanges) => void;
}) {
  const initial = useMemo(
    () => columns.map((_unused, index) => row.cells[index] ?? ""),
    [columns, row.cells],
  );
  const [values, setValues] = useState<string[]>(initial);

  function handleApply() {
    const changes: CsvCellChanges = {};
    columns.forEach((column, index) => {
      if (values[index] !== initial[index]) changes[column] = values[index];
    });
    onApply(changes);
  }

  const isUnchanged = values.every((value, index) => value === initial[index]);

  return (
    <Modal
      title="Edit row"
      description="Changes are written to the uploaded copy. Your original file is untouched — use Export to take the edits away."
      onClose={onCancel}
      isBusy={isBusy}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={isBusy}>
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={isBusy || isUnchanged}>
            {isBusy ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {columns.map((column, index) => (
          <div
            key={`${index}:${column}`}
            className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[12rem_1fr]"
          >
            <label
              className="text-sm font-medium text-ink"
              htmlFor={`edit-cell-${index}`}
            >
              {column}
            </label>
            <input
              id={`edit-cell-${index}`}
              className={DIALOG_INPUT_CLASS}
              value={values[index]}
              disabled={isBusy}
              onChange={(event) =>
                setValues((current) =>
                  current.map((value, at) => (at === index ? event.target.value : value)),
                )
              }
            />
          </div>
        ))}
      </div>
    </Modal>
  );
}

/**
 * Bulk edit for the selected rows: tick a column to include it, type the value
 * every selected row should get.
 *
 * A ticked column left blank **clears** it — that is what "apply this value to
 * all" has to mean, and the description says so rather than leaving someone to
 * find out. Unticked columns are left alone on every row.
 *
 * Unlike CSV Analysis's version there are no locked columns: a delimited file
 * has no primary key, so there is no column where writing the same value to
 * every row would collide.
 */
function BulkEditDialog({
  columns,
  rowCount,
  isBusy,
  onCancel,
  onApply,
}: {
  columns: string[];
  rowCount: number;
  isBusy: boolean;
  onCancel: () => void;
  onApply: (changes: CsvCellChanges) => void;
}) {
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [values, setValues] = useState<Record<string, string>>({});

  function toggleColumn(column: string) {
    setEnabled((current) => {
      const next = new Set(current);
      if (next.has(column)) next.delete(column);
      else next.add(column);
      return next;
    });
  }

  function handleApply() {
    // Only the ticked columns go into the change set; every other column on
    // every selected row is left untouched.
    const changes: CsvCellChanges = {};
    for (const column of columns) {
      if (enabled.has(column)) changes[column] = values[column] ?? "";
    }
    onApply(changes);
  }

  return (
    <Modal
      title={`Bulk edit ${rowCount} row(s)`}
      description="Tick a column to apply its value to every selected row. Unticked columns are left as they are, and a ticked column left blank clears it."
      onClose={onCancel}
      isBusy={isBusy}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={isBusy}>
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={isBusy || enabled.size === 0}>
            {isBusy ? "Applying…" : `Apply to ${rowCount}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {columns.map((column, index) => (
          <div
            key={`${index}:${column}`}
            className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[12rem_1fr]"
          >
            <label className="flex items-center gap-2 text-sm font-medium text-ink">
              <input
                type="checkbox"
                checked={enabled.has(column)}
                onChange={() => toggleColumn(column)}
                className="h-4 w-4 rounded border-line text-brass"
              />
              {column}
            </label>
            <input
              className={DIALOG_INPUT_CLASS}
              disabled={!enabled.has(column) || isBusy}
              value={values[column] ?? ""}
              aria-label={column}
              placeholder={enabled.has(column) ? "Leave blank to clear this column" : ""}
              onChange={(event) =>
                setValues((current) => ({ ...current, [column]: event.target.value }))
              }
            />
          </div>
        ))}
      </div>
    </Modal>
  );
}

function exportHref(fileId: number): string {
  return `/api/tools/csv-browser/${fileId}/export`;
}

/**
 * An absent cell reads as an explicit marker, so it can't be mistaken for an
 * empty string — a short row's missing trailing columns and a genuinely empty
 * cell are different things, and this tool exists partly to show the first.
 */
function renderCell(cell: string | null) {
  if (cell === null) return <span className="text-muted">—</span>;
  if (cell === "") return <span className="text-muted/60">(empty)</span>;
  return <span className="font-mono text-xs">{cell}</span>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
