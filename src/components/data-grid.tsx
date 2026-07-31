"use client";

// Reusable tabular grid. Pure presentation: props in, events out. No data
// fetching, no business logic — the page that fetched the rows passes them in,
// and each column's `render` decides how to draw a cell.
//
// Features: search + per-column filters, click-to-sort headers, a sticky header,
// show/hide/reorder columns, optional row selection with a caller-supplied action
// bar, full cell gridlines, alternating row striping, and a status-bar footer
// with a record count, page-size selection + pagination, an optional "Export CSV"
// action, and an optional "Show SQL" dialog that lets the caller re-run an edited
// query (the caller owns execution via `onRunSql`).
//
// Sorting, filtering, search, and CSV export operate on a column's raw
// `value(row)` primitive, not its rendered ReactNode — a column participates in
// those only when it supplies `value`. The mechanics themselves live in
// `@/lib/shared/table` so they can be unit-tested; this file holds view state.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/button";
import {
  computePageSlice,
  matchesFilter,
  matchesSearch,
  sortRows,
  toCsv,
  type CellValue,
  type SortDirection,
} from "@/lib/shared/table";

export type { CellValue };

export interface DataGridColumn<T> {
  /** Unique key for this column, used as the React key and sort identity. */
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /**
   * Raw primitive for this cell, used for sorting, searching, filtering, and CSV
   * export. A column participates in those only when this is provided.
   */
  value?: (row: T) => CellValue;
  /** Disable sorting for this column even when `value` is set. */
  sortable?: boolean;
  /** Extra classes for both the header and body cells in this column. */
  className?: string;
}

export type PageSize = number | "ALL";

const PAGE_SIZE_OPTIONS: readonly number[] = [10, 25, 50, 100, 200, 500, 1000];
const DEFAULT_PAGE_SIZE = 100;

type SortState = { columnKey: string; direction: SortDirection };

/** Persisted column arrangement, when a `storageKey` is supplied. */
interface ColumnLayout {
  order: string[];
  hidden: string[];
}

export interface DataGridProps<T> {
  columns: DataGridColumn<T>[];
  rows: T[];
  /** Stable identity for each row, used as the React key and selection identity. */
  getRowKey: (row: T) => string | number;
  /** Shown instead of the table body when `rows` is empty. */
  emptyMessage?: string;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
  /** Rows per page. Defaults to 100. Pagination appears once rows exceed it. */
  defaultPageSize?: PageSize;
  /** Show the "Export CSV" button (only appears when a column supplies `value`). Default true. */
  enableExport?: boolean;
  /** Base filename (without extension) for the exported CSV. Defaults to "export". */
  exportFileName?: string;
  /** Show the search box. Default true (needs at least one column with `value`). */
  enableSearch?: boolean;
  /** Offer the per-column filter row (hidden until the user opens it). Default true. */
  enableColumnFilters?: boolean;
  /** Offer the show/hide/reorder columns panel. Default true. */
  enableColumnPicker?: boolean;
  /** Keep the header visible while the table body scrolls. Default true. */
  stickyHeader?: boolean;
  /** Max height of the scroll area, e.g. "70vh". Pass "" to remove the cap. */
  maxHeight?: string;
  /** Add a checkbox column. Default false. */
  enableSelection?: boolean;
  /** Rendered in the toolbar while rows are selected — put bulk actions here. */
  renderSelectionActions?: (selectedRows: T[], clearSelection: () => void) => ReactNode;
  /**
   * When set, the column arrangement (order + hidden) is remembered in
   * localStorage under this key.
   */
  storageKey?: string;
  /**
   * When set, each row becomes clickable (and keyboard-focusable) and this is
   * called with the row. Use for "open this record" navigation.
   */
  onRowClick?: (row: T) => void;
  /** The SQL that produced these rows. With `onRunSql`, a "Show SQL" button appears. */
  sql?: string;
  /** Called with the edited SQL when the user runs it from the "Show SQL" dialog. */
  onRunSql?: (sql: string) => void | Promise<void>;
}

const CONTROL_CLASS =
  "rounded-md border border-line bg-paper px-2 py-1 text-xs text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

function readStoredLayout(storageKey: string | undefined): ColumnLayout | undefined {
  if (!storageKey || typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(`datagrid:${storageKey}`);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<ColumnLayout>;
    if (!Array.isArray(parsed.order) || !Array.isArray(parsed.hidden)) return undefined;
    return { order: parsed.order, hidden: parsed.hidden };
  } catch {
    // A corrupt or unreadable entry just means "no saved layout" — the grid still
    // renders with its default column arrangement.
    return undefined;
  }
}

export function DataGrid<T>({
  columns,
  rows,
  getRowKey,
  emptyMessage = "No rows to show.",
  className = "",
  defaultPageSize = DEFAULT_PAGE_SIZE,
  enableExport = true,
  exportFileName = "export",
  enableSearch = true,
  enableColumnFilters = true,
  enableColumnPicker = true,
  stickyHeader = true,
  maxHeight = "70vh",
  enableSelection = false,
  renderSelectionActions,
  storageKey,
  onRowClick,
  sql,
  onRunSql,
}: DataGridProps<T>) {
  const [sort, setSort] = useState<SortState | undefined>(undefined);
  const [pageSize, setPageSize] = useState<PageSize>(defaultPageSize);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [showFilterRow, setShowFilterRow] = useState(false);
  const [showColumnPanel, setShowColumnPanel] = useState(false);
  const [layout, setLayout] = useState<ColumnLayout>({ order: [], hidden: [] });
  const [selectedKeys, setSelectedKeys] = useState<Set<string | number>>(new Set());
  const [showSqlDialog, setShowSqlDialog] = useState(false);
  const [sqlDraft, setSqlDraft] = useState(sql ?? "");
  const [isRunningSql, setIsRunningSql] = useState(false);

  // Restored after mount rather than in the initial state so server and client
  // render the same markup (localStorage isn't available during SSR).
  useEffect(() => {
    const stored = readStoredLayout(storageKey);
    // Syncing from an external system (localStorage) on mount, not reacting to React state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored) setLayout(stored);
  }, [storageKey]);

  function persistLayout(next: ColumnLayout) {
    setLayout(next);
    if (!storageKey || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(`datagrid:${storageKey}`, JSON.stringify(next));
    } catch {
      // Storage can be full or blocked (private mode); the layout still applies
      // for this session, so there's nothing to recover from here.
    }
  }

  // Columns in their display order, with unknown/stale keys from a saved layout
  // ignored and newly-added columns appended.
  const orderedColumns = useMemo(() => {
    if (layout.order.length === 0) return columns;
    const byKey = new Map(columns.map((column) => [column.key, column]));
    const ordered = layout.order
      .map((key) => byKey.get(key))
      .filter((column): column is DataGridColumn<T> => column !== undefined);
    const seen = new Set(ordered.map((column) => column.key));
    return [...ordered, ...columns.filter((column) => !seen.has(column.key))];
  }, [columns, layout.order]);

  const hiddenKeys = useMemo(() => new Set(layout.hidden), [layout.hidden]);
  const visibleColumns = useMemo(
    () => orderedColumns.filter((column) => !hiddenKeys.has(column.key)),
    [orderedColumns, hiddenKeys],
  );

  const searchableColumns = useMemo(
    () => visibleColumns.filter((column) => column.value !== undefined),
    [visibleColumns],
  );

  const filteredRows = useMemo(() => {
    const activeFilters = Object.entries(columnFilters).filter(([, filter]) => filter.trim() !== "");
    const hasSearch = search.trim() !== "";
    if (!hasSearch && activeFilters.length === 0) return rows;

    return rows.filter((row) => {
      if (hasSearch) {
        const values = searchableColumns.map((column) => column.value!(row));
        if (!matchesSearch(values, search)) return false;
      }
      return activeFilters.every(([key, filter]) => {
        const column = visibleColumns.find((candidate) => candidate.key === key);
        if (!column?.value) return true;
        return matchesFilter(column.value(row), filter);
      });
    });
  }, [rows, search, columnFilters, searchableColumns, visibleColumns]);

  const sortedRows = useMemo(() => {
    if (!sort) return filteredRows;
    const column = visibleColumns.find((candidate) => candidate.key === sort.columnKey);
    if (!column?.value) return filteredRows;
    return sortRows(filteredRows, column.value, sort.direction);
  }, [filteredRows, sort, visibleColumns]);

  const total = sortedRows.length;
  const slice = computePageSlice(total, pageSize, page);
  const visibleRows = sortedRows.slice(slice.startIndex, slice.endIndex);

  const hasExportableColumns = visibleColumns.some((column) => column.value !== undefined);
  const showExport = enableExport && hasExportableColumns;
  const showSql = sql !== undefined && onRunSql !== undefined;
  const showSearch = enableSearch && searchableColumns.length > 0;
  const isFiltered = search.trim() !== "" || Object.values(columnFilters).some((f) => f.trim() !== "");

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedKeys.has(getRowKey(row))),
    [rows, selectedKeys, getRowKey],
  );
  // Select-all acts on the filtered set, not just the current page, so it means
  // "everything you're currently looking at".
  const allFilteredSelected =
    sortedRows.length > 0 && sortedRows.every((row) => selectedKeys.has(getRowKey(row)));
  const someFilteredSelected =
    !allFilteredSelected && sortedRows.some((row) => selectedKeys.has(getRowKey(row)));

  function toggleSort(column: DataGridColumn<T>) {
    if (!column.value || column.sortable === false) return;
    setPage(0);
    setSort((current) => {
      if (!current || current.columnKey !== column.key) return { columnKey: column.key, direction: "asc" };
      if (current.direction === "asc") return { columnKey: column.key, direction: "desc" };
      return undefined; // third click clears the sort
    });
  }

  function updateColumnFilter(key: string, filter: string) {
    setPage(0);
    setColumnFilters((current) => ({ ...current, [key]: filter }));
  }

  function toggleColumnVisibility(key: string) {
    const hidden = new Set(layout.hidden);
    if (hidden.has(key)) hidden.delete(key);
    // Never hide the last visible column — an all-hidden grid shows nothing and
    // offers no way back except the panel it just emptied.
    else if (visibleColumns.length > 1) hidden.add(key);
    persistLayout({ order: orderedColumns.map((column) => column.key), hidden: [...hidden] });
  }

  function moveColumn(key: string, offset: -1 | 1) {
    const order = orderedColumns.map((column) => column.key);
    const index = order.indexOf(key);
    const target = index + offset;
    if (index === -1 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    persistLayout({ order, hidden: layout.hidden });
  }

  function resetColumns() {
    persistLayout({ order: [], hidden: [] });
  }

  function toggleRowSelection(row: T) {
    const key = getRowKey(row);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (allFilteredSelected) for (const row of sortedRows) next.delete(getRowKey(row));
      else for (const row of sortedRows) next.add(getRowKey(row));
      return next;
    });
  }

  function handleExport() {
    const exportColumns = visibleColumns.filter((column) => column.value !== undefined);
    if (exportColumns.length === 0) return;
    // Exports what's on screen: current filters and sort, all pages.
    const csv = toCsv(
      exportColumns.map((column) => column.header),
      sortedRows.map((row) => exportColumns.map((column) => column.value!(row))),
    );
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
      : slice.totalPages > 1
        ? `${(slice.startIndex + 1).toLocaleString()}–${slice.endIndex.toLocaleString()} of ${total.toLocaleString()} records`
        : `${total.toLocaleString()} record${total === 1 ? "" : "s"}`;
  const filteredNote = isFiltered ? ` (filtered from ${rows.length.toLocaleString()})` : "";

  const columnCount = visibleColumns.length + (enableSelection ? 1 : 0);
  const headerCellClass = `relative z-10 border border-line bg-brass-soft px-4 py-2.5 text-center font-bold text-brass-dark shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_3px_5px_-1px_rgba(0,0,0,0.45)] ${
    stickyHeader ? "sticky top-0" : ""
  }`;

  const hasToolbar = showSearch || enableColumnFilters || enableColumnPicker || enableSelection;

  return (
    // overflow-hidden keeps the toolbar/status-bar backgrounds inside the rounded
    // corners; the inner scroll container is what the sticky header sticks to, so
    // this doesn't interfere with it.
    <div className={`overflow-hidden rounded-xl border border-line ${className}`}>
      {hasToolbar && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-paper-raised px-3 py-2">
          {showSearch && (
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
              placeholder="Search…"
              aria-label="Search rows"
              className={`${CONTROL_CLASS} w-48`}
            />
          )}
          {enableColumnFilters && (
            <Button size="sm" variant="secondary" onClick={() => setShowFilterRow((open) => !open)}>
              {showFilterRow ? "Hide filters" : "Filters"}
            </Button>
          )}
          {enableColumnPicker && (
            <Button size="sm" variant="secondary" onClick={() => setShowColumnPanel((open) => !open)}>
              Columns
            </Button>
          )}
          {isFiltered && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setColumnFilters({});
                setPage(0);
              }}
              className="text-xs text-brass-dark hover:underline"
            >
              Clear filters
            </button>
          )}
          {enableSelection && selectedRows.length > 0 && (
            <span className="ml-auto flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">{selectedRows.length} selected</span>
              {renderSelectionActions?.(selectedRows, () => setSelectedKeys(new Set()))}
              <button
                type="button"
                onClick={() => setSelectedKeys(new Set())}
                className="text-xs text-brass-dark hover:underline"
              >
                Clear selection
              </button>
            </span>
          )}
        </div>
      )}

      {showColumnPanel && enableColumnPicker && (
        <div className="border-b border-line bg-paper px-3 py-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Columns</p>
            <button type="button" onClick={resetColumns} className="text-xs text-brass-dark hover:underline">
              Reset
            </button>
          </div>
          <ul className="flex flex-col gap-1">
            {orderedColumns.map((column, index) => (
              <li key={column.key} className="flex items-center gap-2 text-xs text-ink">
                <label className="flex flex-1 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!hiddenKeys.has(column.key)}
                    onChange={() => toggleColumnVisibility(column.key)}
                  />
                  {column.header}
                </label>
                <button
                  type="button"
                  onClick={() => moveColumn(column.key, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${column.header} earlier`}
                  className="rounded-md border border-line px-1.5 text-ink disabled:opacity-40"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveColumn(column.key, 1)}
                  disabled={index === orderedColumns.length - 1}
                  aria-label={`Move ${column.header} later`}
                  className="rounded-md border border-line px-1.5 text-ink disabled:opacity-40"
                >
                  ↓
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {enableSelection && (
                <th className={`${headerCellClass} w-10`}>
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    ref={(node) => {
                      if (node) node.indeterminate = someFilteredSelected;
                    }}
                    onChange={toggleSelectAll}
                    aria-label="Select all rows"
                  />
                </th>
              )}
              {visibleColumns.map((column) => {
                const isSortable = column.value !== undefined && column.sortable !== false;
                const activeSort = sort?.columnKey === column.key ? sort.direction : undefined;
                return (
                  <th
                    key={column.key}
                    onClick={isSortable ? () => toggleSort(column) : undefined}
                    aria-sort={activeSort ? (activeSort === "asc" ? "ascending" : "descending") : undefined}
                    className={`${headerCellClass} ${
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
            {showFilterRow && enableColumnFilters && (
              <tr>
                {enableSelection && <th className="border border-line bg-paper px-2 py-1" />}
                {visibleColumns.map((column) => (
                  <th key={column.key} className="border border-line bg-paper px-2 py-1">
                    {column.value ? (
                      <input
                        type="text"
                        value={columnFilters[column.key] ?? ""}
                        onChange={(event) => updateColumnFilter(column.key, event.target.value)}
                        placeholder="Filter…"
                        aria-label={`Filter by ${column.header}`}
                        className={`${CONTROL_CLASS} w-full font-normal`}
                      />
                    ) : null}
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="border border-line px-4 py-8 text-center text-muted">
                  {isFiltered ? "No rows match the current search or filters." : emptyMessage}
                </td>
              </tr>
            ) : (
              visibleRows.map((row, index) => {
                const key = getRowKey(row);
                return (
                  // A clickable row keeps its native <tr> semantics (role="button" on a
                  // table row would break the grid for screen readers); it gains
                  // tabIndex + Enter/Space handling so it's still keyboard-reachable.
                  <tr
                    key={key}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    onKeyDown={
                      onRowClick
                        ? (event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onRowClick(row);
                            }
                          }
                        : undefined
                    }
                    tabIndex={onRowClick ? 0 : undefined}
                    className={`${index % 2 === 1 ? "bg-paper-raised" : "bg-paper"} ${
                      selectedKeys.has(key) ? "outline outline-1 -outline-offset-1 outline-brass/40" : ""
                    } ${
                      onRowClick
                        ? "cursor-pointer hover:bg-brass-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brass"
                        : ""
                    }`}
                  >
                    {enableSelection && (
                      // Stops the click from also triggering onRowClick — ticking a
                      // checkbox shouldn't navigate away from the list.
                      <td
                        className="border border-line px-4 py-2.5 text-center"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={selectedKeys.has(key)}
                          onChange={() => toggleRowSelection(row)}
                          aria-label="Select row"
                        />
                      </td>
                    )}
                    {visibleColumns.map((column) => (
                      <td
                        key={column.key}
                        className={`border border-line px-4 py-2.5 text-ink ${column.className ?? ""}`}
                      >
                        {column.render(row)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Raised status bar: a top highlight plus a cast shadow lifts it off the
          table, the same bevel mechanic the header bar uses (rather than the
          recessed inset it had before). */}
      <div className="relative z-10 border-t border-line bg-paper-raised px-4 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_-3px_6px_-2px_rgba(0,0,0,0.5)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
            <span>
              {rangeLabel}
              {filteredNote}
            </span>
            <label className="flex items-center gap-1">
              <span>Per page</span>
              <select
                value={String(pageSize)}
                onChange={(event) => {
                  setPageSize(event.target.value === "ALL" ? "ALL" : Number(event.target.value));
                  setPage(0);
                }}
                className={CONTROL_CLASS}
              >
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
                <option value="ALL">ALL</option>
              </select>
            </label>
            {slice.totalPages > 1 && (
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={slice.page === 0}
                  onClick={() => setPage((current) => Math.max(0, current - 1))}
                  className="rounded-md border border-line px-2 py-1 text-ink disabled:opacity-40"
                >
                  Prev
                </button>
                <span>
                  Page {slice.page + 1} of {slice.totalPages}
                </span>
                <button
                  type="button"
                  disabled={slice.page >= slice.totalPages - 1}
                  onClick={() => setPage((current) => Math.min(slice.totalPages - 1, current + 1))}
                  className="rounded-md border border-line px-2 py-1 text-ink disabled:opacity-40"
                >
                  Next
                </button>
              </span>
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
      </div>

      {showSqlDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-line bg-paper-raised p-4">
            <h3 className="mb-3 font-display text-lg text-ink">SQL Query</h3>
            <textarea
              value={sqlDraft}
              onChange={(event) => setSqlDraft(event.target.value)}
              rows={10}
              className="w-full rounded-md border border-line bg-paper px-3 py-2 font-mono text-xs text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
            />
            <div className="mt-3 flex justify-end gap-2">
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
