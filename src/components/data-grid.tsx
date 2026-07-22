"use client";

// Reusable tabular grid. Pure presentation: props in, events out. No data
// fetching, no business logic — the page that fetched the rows passes them in,
// and each column's `render` decides how to draw a cell.
//
// Features: click-to-sort headers (asc/desc/none), full cell gridlines,
// centered bold headers, alternating row striping, and a status-bar footer
// with a total-record count, page-size selection + pagination, an optional
// "Export CSV" action, and an optional "Show SQL" dialog that lets the caller
// re-run an edited query (the caller owns execution via `onRunSql`).
//
// Sorting and CSV export operate on a column's raw `value(row)` primitive, not
// its rendered ReactNode — a column is sortable/exportable only when it
// supplies `value`. CSV serialization of the already-displayed values is done
// inline here as a view-local concern (kept deliberately small).

import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/button";

export type CellValue = string | number | null;

export interface DataGridColumn<T> {
  /** Unique key for this column, used as the React key and sort identity. */
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /**
   * Raw primitive for this cell, used for sorting and CSV export. A column is
   * sortable and exportable only when this is provided.
   */
  value?: (row: T) => CellValue;
  /** Disable sorting for this column even when `value` is set. */
  sortable?: boolean;
  /** Extra classes for both the header and body cells in this column. */
  className?: string;
}

export type PageSize = number | "ALL";

const PAGE_SIZE_OPTIONS: readonly number[] = [100, 200, 500, 1000];
const SMALLEST_PAGE_SIZE = PAGE_SIZE_OPTIONS[0];

type SortState = { columnKey: string; direction: "asc" | "desc" };

export interface DataGridProps<T> {
  columns: DataGridColumn<T>[];
  rows: T[];
  /** Stable identity for each row, used as the React key. */
  getRowKey: (row: T) => string | number;
  /** Shown instead of the table body when `rows` is empty. */
  emptyMessage?: string;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
  /** Rows per page before the status bar offers pagination. Defaults to 100. */
  defaultPageSize?: PageSize;
  /** Show the "Export CSV" button (only appears when a column supplies `value`). Default true. */
  enableExport?: boolean;
  /** Base filename (without extension) for the exported CSV. Defaults to "export". */
  exportFileName?: string;
  /** The SQL that produced these rows. With `onRunSql`, a "Show SQL" button appears. */
  sql?: string;
  /** Called with the edited SQL when the user runs it from the "Show SQL" dialog. */
  onRunSql?: (sql: string) => void | Promise<void>;
}

function compareValues(a: CellValue, b: CellValue): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // nulls sort last
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

function toCsvField(value: CellValue): string {
  const text = value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function DataGrid<T>({
  columns,
  rows,
  getRowKey,
  emptyMessage = "No rows to show.",
  className = "",
  defaultPageSize = SMALLEST_PAGE_SIZE,
  enableExport = true,
  exportFileName = "export",
  sql,
  onRunSql,
}: DataGridProps<T>) {
  const [sort, setSort] = useState<SortState | undefined>(undefined);
  const [pageSize, setPageSize] = useState<PageSize>(defaultPageSize);
  const [page, setPage] = useState(0);
  const [showSqlDialog, setShowSqlDialog] = useState(false);
  const [sqlDraft, setSqlDraft] = useState(sql ?? "");
  const [isRunningSql, setIsRunningSql] = useState(false);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((candidate) => candidate.key === sort.columnKey);
    if (!column?.value) return rows;
    const accessor = column.value;
    const direction = sort.direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => compareValues(accessor(a), accessor(b)) * direction);
  }, [rows, sort, columns]);

  const total = sortedRows.length;
  const paginated = total > SMALLEST_PAGE_SIZE;
  const effectivePageSize = pageSize === "ALL" ? total : pageSize;
  const totalPages = pageSize === "ALL" ? 1 : Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const start = pageSize === "ALL" ? 0 : safePage * pageSize;
  const visibleRows = paginated ? sortedRows.slice(start, start + effectivePageSize) : sortedRows;

  const hasExportableColumns = columns.some((column) => column.value !== undefined);
  const showExport = enableExport && hasExportableColumns;
  const showSql = sql !== undefined && onRunSql !== undefined;

  function toggleSort(column: DataGridColumn<T>) {
    if (!column.value || column.sortable === false) return;
    setPage(0);
    setSort((current) => {
      if (!current || current.columnKey !== column.key) return { columnKey: column.key, direction: "asc" };
      if (current.direction === "asc") return { columnKey: column.key, direction: "desc" };
      return undefined; // third click clears the sort
    });
  }

  function changePageSize(next: PageSize) {
    setPageSize(next);
    setPage(0);
  }

  function handleExport() {
    const exportColumns = columns.filter((column) => column.value !== undefined);
    if (exportColumns.length === 0) return;
    const header = exportColumns.map((column) => toCsvField(column.header)).join(",");
    const body = sortedRows.map((row) =>
      exportColumns.map((column) => toCsvField(column.value!(row))).join(","),
    );
    const csv = [header, ...body].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${exportFileName}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  async function handleRunSql() {
    if (!onRunSql) return;
    setIsRunningSql(true);
    try {
      await onRunSql(sqlDraft);
      setShowSqlDialog(false);
    } finally {
      setIsRunningSql(false);
    }
  }

  const rangeLabel =
    total === 0
      ? "0 records"
      : paginated && pageSize !== "ALL"
        ? `${(start + 1).toLocaleString()}–${Math.min(start + effectivePageSize, total).toLocaleString()} of ${total.toLocaleString()} records`
        : `${total.toLocaleString()} record${total === 1 ? "" : "s"}`;

  return (
    <div className={`overflow-x-auto rounded-xl border border-line ${className}`}>
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr>
            {columns.map((column) => {
              const isSortable = column.value !== undefined && column.sortable !== false;
              const activeSort = sort?.columnKey === column.key ? sort.direction : undefined;
              return (
                <th
                  key={column.key}
                  onClick={isSortable ? () => toggleSort(column) : undefined}
                  aria-sort={activeSort ? (activeSort === "asc" ? "ascending" : "descending") : undefined}
                  className={`relative z-10 border border-line bg-brass-soft px-4 py-2.5 text-center font-bold text-brass-dark shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_3px_5px_-1px_rgba(0,0,0,0.45)] ${
                    isSortable ? "cursor-pointer select-none hover:text-brass" : ""
                  } ${column.className ?? ""}`}
                >
                  <span className="inline-flex items-center justify-center gap-1">
                    {column.header}
                    {activeSort && <span aria-hidden>{activeSort === "asc" ? "▲" : "▼"}</span>}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {visibleRows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="border border-line px-4 py-8 text-center text-muted">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            visibleRows.map((row, index) => (
              <tr key={getRowKey(row)} className={index % 2 === 1 ? "bg-paper-raised" : "bg-paper"}>
                {columns.map((column) => (
                  <td key={column.key} className={`border border-line px-4 py-2.5 text-ink ${column.className ?? ""}`}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr>
            <td
              colSpan={columns.length}
              className="border border-line bg-paper px-4 py-2 shadow-[inset_0_2px_5px_rgba(0,0,0,0.5)]"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
                  <span>{rangeLabel}</span>
                  {paginated && (
                    <>
                      <label className="flex items-center gap-1">
                        <span>Per page</span>
                        <select
                          value={String(pageSize)}
                          onChange={(event) =>
                            changePageSize(event.target.value === "ALL" ? "ALL" : Number(event.target.value))
                          }
                          className="rounded-md border border-line bg-paper px-2 py-1 text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
                        >
                          {PAGE_SIZE_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                          <option value="ALL">ALL</option>
                        </select>
                      </label>
                      {pageSize !== "ALL" && totalPages > 1 && (
                        <span className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={safePage === 0}
                            onClick={() => setPage((current) => Math.max(0, current - 1))}
                            className="rounded-md border border-line px-2 py-1 text-ink disabled:opacity-40"
                          >
                            Prev
                          </button>
                          <span>
                            Page {safePage + 1} of {totalPages}
                          </span>
                          <button
                            type="button"
                            disabled={safePage >= totalPages - 1}
                            onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
                            className="rounded-md border border-line px-2 py-1 text-ink disabled:opacity-40"
                          >
                            Next
                          </button>
                        </span>
                      )}
                    </>
                  )}
                </div>
                {(showExport || showSql) && (
                  <div className="flex items-center gap-2">
                    {showExport && (
                      <Button size="sm" variant="secondary" onClick={handleExport}>
                        Export CSV
                      </Button>
                    )}
                    {showSql && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setSqlDraft(sql ?? "");
                          setShowSqlDialog(true);
                        }}
                      >
                        Show SQL
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </td>
          </tr>
        </tfoot>
      </table>

      {showSqlDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-line bg-paper-raised p-5 shadow-lg">
            <h3 className="mb-3 font-display text-lg text-ink">SQL Query</h3>
            <textarea
              value={sqlDraft}
              onChange={(event) => setSqlDraft(event.target.value)}
              rows={8}
              className="w-full rounded-md border border-line bg-paper px-3 py-2 font-mono text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowSqlDialog(false)} disabled={isRunningSql}>
                Cancel
              </Button>
              <Button onClick={handleRunSql} disabled={isRunningSql || sqlDraft.trim() === ""}>
                {isRunningSql ? "Running…" : "OK"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
