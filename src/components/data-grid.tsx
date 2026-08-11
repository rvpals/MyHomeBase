"use client";

// Reusable tabular grid. Pure presentation: props in, events out. No data
// fetching, no business logic — the page that fetched the rows passes them in,
// and each column's `render` decides how to draw a cell.
//
// Features: search + per-column filters (with >, <, !=, = and range operators),
// click-to-sort headers, a sticky header, show/hide/reorder/resize columns, a
// row-density control, an optional per-column footer total, optional row
// selection with a caller-supplied action bar, a single-record modal showing
// every field (including hidden columns), and a status-bar footer with a record
// count, page-size selection + pagination, an optional "Export CSV" action, and
// an optional "Show SQL" dialog that lets the caller re-run an edited query (the
// caller owns execution via `onRunSql`).
//
// Sorting, filtering, search, CSV export and footer totals operate on a column's
// raw `value(row)` primitive, not its rendered ReactNode — a column participates
// in those only when it supplies `value`. The mechanics themselves live in
// `@/lib/shared/table` so they can be unit-tested; this file holds view state.

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Button } from "@/components/button";
import { DataGridCompact } from "@/components/data-grid-compact";
import { Modal } from "@/components/modal";
import { useIsCompact } from "@/components/viewport-context";
import {
  aggregate,
  computePageSlice,
  matchesFilter,
  matchesSearch,
  sortRows,
  toCsv,
  type AggregateKind,
  type CellValue,
  type SortDirection,
} from "@/lib/shared/table";

export type { CellValue, AggregateKind };

export interface DataGridColumn<T> {
  /** Unique key for this column, used as the React key and sort identity. */
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /**
   * Raw primitive for this cell, used for sorting, searching, filtering, CSV
   * export, and the footer total. A column participates in those only when this
   * is provided.
   */
  value?: (row: T) => CellValue;
  /** Disable sorting for this column even when `value` is set. */
  sortable?: boolean;
  /** Extra classes for both the header and body cells in this column. */
  className?: string;
  /**
   * Show a rollup of this column in the table footer, over the filtered set
   * across all pages. Requires `value`.
   */
  aggregate?: AggregateKind;
  /** Formats the footer total, e.g. as currency. Defaults to `toLocaleString()`. */
  formatAggregate?: (result: number) => ReactNode;
  /** Smallest width in pixels this column may be dragged to. Defaults to 64. */
  minWidth?: number;
  /**
   * Keep this column out of the single-record modal. Set it on action columns —
   * a row's Edit/Delete buttons don't belong in a read-out of the record.
   */
  excludeFromRecordView?: boolean;
}

export type PageSize = number | "ALL";

/** Row height / padding. Persisted with the column layout. */
export type Density = "compact" | "normal" | "comfortable";

const PAGE_SIZE_OPTIONS: readonly number[] = [10, 25, 50, 100, 200, 500, 1000];
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MIN_COLUMN_WIDTH = 64;

type SortState = { columnKey: string; direction: SortDirection };

const densityClasses: Record<Density, { header: string; cell: string }> = {
  compact: { header: "px-2 py-1.5", cell: "px-2 py-1" },
  normal: { header: "px-4 py-2.5", cell: "px-4 py-2.5" },
  comfortable: { header: "px-5 py-3.5", cell: "px-5 py-4" },
};

/** Short label shown beside a footer total, so "136.83" reads as a sum. */
const aggregateLabels: Record<AggregateKind, string> = {
  sum: "Σ",
  avg: "avg",
  min: "min",
  max: "max",
  count: "n",
};

/**
 * The view state remembered per `storageKey`. Version 1 stored only `order` and
 * `hidden`; those entries are still read, with everything else defaulted, so
 * nobody loses their column arrangement to this upgrade.
 */
interface StoredView {
  version?: number;
  order: string[];
  hidden: string[];
  widths?: Record<string, number>;
  density?: Density;
  sort?: SortState;
  pageSize?: PageSize;
}

/** The parts of the view this component keeps together and persists. */
interface ColumnLayout {
  order: string[];
  hidden: string[];
  /** Pixel widths by column key. Empty means "let the browser size the table". */
  widths: Record<string, number>;
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
  /**
   * Show the status bar (record count, per-page selector, pagination, Export CSV
   * and Show SQL). Default true. Set false for a bare grid with no footer bar.
   */
  showStatusBar?: boolean;
  /** Base filename (without extension) for the exported CSV. Defaults to "export". */
  exportFileName?: string;
  /** Show the search box. Default true (needs at least one column with `value`). */
  enableSearch?: boolean;
  /** Offer the per-column filter row (hidden until the user opens it). Default true. */
  enableColumnFilters?: boolean;
  /** Offer the show/hide/reorder columns panel. Default true. */
  enableColumnPicker?: boolean;
  /** Allow dragging column edges to resize. Default true. */
  enableColumnResize?: boolean;
  /** Offer the compact/normal/comfortable control. Default true. */
  enableDensity?: boolean;
  /** Starting density, until the user changes it. Defaults to "normal". */
  defaultDensity?: Density;
  /** Keep the header visible while the table body scrolls. Default true. */
  stickyHeader?: boolean;
  /** Max height of the scroll area, e.g. "70vh". Pass "" to remove the cap. */
  maxHeight?: string;
  /** Add a checkbox column. Default false. */
  enableSelection?: boolean;
  /** Rendered in the toolbar while rows are selected — put bulk actions here. */
  renderSelectionActions?: (selectedRows: T[], clearSelection: () => void) => ReactNode;
  /**
   * Add a per-row button that opens the record in a modal, listing every column
   * including the ones currently hidden. Default true.
   */
  enableRecordView?: boolean;
  /** Heading for the record modal. Defaults to "Record". */
  recordViewTitle?: (row: T) => string;
  /**
   * When set, the view (column order, hidden columns, widths, density, sort and
   * page size) is remembered in localStorage under this key. Search and column
   * filters are deliberately *not* persisted — reopening a page to a
   * mysteriously near-empty grid is worse than retyping a filter.
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

function storageEntryKey(storageKey: string): string {
  return `datagrid:${storageKey}`;
}

function readStoredView(storageKey: string | undefined): StoredView | undefined {
  if (!storageKey || typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(storageEntryKey(storageKey));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<StoredView>;
    if (!Array.isArray(parsed.order) || !Array.isArray(parsed.hidden)) return undefined;
    return parsed as StoredView;
  } catch {
    // A corrupt or unreadable entry just means "no saved view" — the grid still
    // renders with its default arrangement.
    return undefined;
  }
}

/** Row-view glyph. Local to the grid: nothing else renders it. */
function RecordViewIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.75" />
    </svg>
  );
}

/**
 * Picks the table or the card list, by layout.
 *
 * A thin dispatcher rather than an early return inside the implementation
 * below: that one calls fifteen-odd hooks, and returning before them would
 * change the hook count when the viewport flips (which it does, once, when the
 * width corrector overrules the User-Agent guess) — React would throw. Two
 * sibling components mount and unmount cleanly instead.
 *
 * Callers never choose. Every grid in the app gets the compact treatment
 * without touching a single call site.
 */
export function DataGrid<T>(props: DataGridProps<T>) {
  const isCompact = useIsCompact();

  if (isCompact) {
    return (
      <DataGridCompact
        columns={props.columns}
        rows={props.rows}
        getRowKey={props.getRowKey}
        emptyMessage={props.emptyMessage}
        enableSearch={props.enableSearch}
        onRowClick={props.onRowClick}
        className={props.className}
      />
    );
  }

  return <DataGridFull {...props} />;
}

function DataGridFull<T>({
  columns,
  rows,
  getRowKey,
  emptyMessage = "No rows to show.",
  className = "",
  defaultPageSize = DEFAULT_PAGE_SIZE,
  enableExport = true,
  showStatusBar = true,
  exportFileName = "export",
  enableSearch = true,
  enableColumnFilters = true,
  enableColumnPicker = true,
  enableColumnResize = true,
  enableDensity = true,
  defaultDensity = "normal",
  stickyHeader = true,
  maxHeight = "70vh",
  enableSelection = false,
  renderSelectionActions,
  enableRecordView = true,
  recordViewTitle,
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
  const [layout, setLayout] = useState<ColumnLayout>({ order: [], hidden: [], widths: {} });
  const [density, setDensity] = useState<Density>(defaultDensity);
  const [selectedKeys, setSelectedKeys] = useState<Set<string | number>>(new Set());
  const [showSqlDialog, setShowSqlDialog] = useState(false);
  const [sqlDraft, setSqlDraft] = useState(sql ?? "");
  const [isRunningSql, setIsRunningSql] = useState(false);
  const [recordIndex, setRecordIndex] = useState<number | undefined>(undefined);
  const [resizingKey, setResizingKey] = useState<string | undefined>(undefined);

  const tableRef = useRef<HTMLTableElement>(null);
  // Set once the saved view has been read, so the persist effect below doesn't
  // write defaults over a stored view before it has been restored.
  const hasHydrated = useRef(false);
  const resizeStart = useRef<{ key: string; startX: number; baseWidths: Record<string, number> } | null>(
    null,
  );

  // Restored after mount rather than in the initial state so server and client
  // render the same markup (localStorage isn't available during SSR).
  useEffect(() => {
    const stored = readStoredView(storageKey);
    /* eslint-disable react-hooks/set-state-in-effect --
       Syncing from an external system (localStorage) on mount, not reacting to React state. */
    if (stored) {
      setLayout({
        order: stored.order,
        hidden: stored.hidden,
        widths: stored.widths ?? {},
      });
      if (stored.density) setDensity(stored.density);
      if (stored.sort) setSort(stored.sort);
      if (stored.pageSize !== undefined) setPageSize(stored.pageSize);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    hasHydrated.current = true;
  }, [storageKey]);

  // One place that writes the view back, rather than a persist call threaded
  // through every control that can change it.
  useEffect(() => {
    if (!hasHydrated.current || !storageKey || typeof window === "undefined") return;
    // A drag fires a width change per pointer-move; waiting for the drag to end
    // turns hundreds of localStorage writes into one. `resizingKey` becoming
    // undefined re-runs this effect, so the final widths are still saved.
    if (resizingKey) return;
    const view: StoredView = {
      version: 2,
      order: layout.order,
      hidden: layout.hidden,
      widths: layout.widths,
      density,
      sort,
      pageSize,
    };
    try {
      window.localStorage.setItem(storageEntryKey(storageKey), JSON.stringify(view));
    } catch {
      // Storage can be full or blocked (private mode); the view still applies for
      // this session, so there's nothing to recover from here.
    }
  }, [storageKey, layout, density, sort, pageSize, resizingKey]);

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

    // Resolved once rather than per row — this runs for every row on every
    // keystroke, so a find() per row per filter is worth avoiding.
    const columnsByKey = new Map(visibleColumns.map((column) => [column.key, column]));

    return rows.filter((row) => {
      if (hasSearch) {
        const values = searchableColumns.map((column) => column.value!(row));
        if (!matchesSearch(values, search)) return false;
      }
      return activeFilters.every(([key, filter]) => {
        const column = columnsByKey.get(key);
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

  // Selection is always a subset of what the current search/filters show, so the
  // "12 selected" count always equals what a bulk action will touch. Rows that
  // drop out of the filtered set (or out of `rows` entirely, after a delete)
  // lose their tick.
  //
  // Adjusted during render rather than in an effect: this is React's documented
  // "reset state when a prop changes" pattern, so the discarded render is thrown
  // away before it commits — an effect would paint the stale count first, then
  // immediately re-render.
  const [lastFilteredRows, setLastFilteredRows] = useState(filteredRows);
  if (lastFilteredRows !== filteredRows) {
    setLastFilteredRows(filteredRows);
    if (selectedKeys.size > 0) {
      const available = new Set(filteredRows.map(getRowKey));
      const pruned = new Set([...selectedKeys].filter((key) => available.has(key)));
      if (pruned.size !== selectedKeys.size) setSelectedKeys(pruned);
    }
  }

  const hasExportableColumns = visibleColumns.some((column) => column.value !== undefined);
  const showExport = enableExport && hasExportableColumns;
  const showSql = sql !== undefined && onRunSql !== undefined;
  const showSearch = enableSearch && searchableColumns.length > 0;
  const isFiltered = search.trim() !== "" || Object.values(columnFilters).some((f) => f.trim() !== "");

  const selectedRows = useMemo(
    () => filteredRows.filter((row) => selectedKeys.has(getRowKey(row))),
    [filteredRows, selectedKeys, getRowKey],
  );
  // Select-all acts on the filtered set, not just the current page, so it means
  // "everything you're currently looking at".
  const allFilteredSelected =
    sortedRows.length > 0 && sortedRows.every((row) => selectedKeys.has(getRowKey(row)));
  const someFilteredSelected =
    !allFilteredSelected && sortedRows.some((row) => selectedKeys.has(getRowKey(row)));

  // Includes whatever the grid is currently paged to, so a stored page size that
  // isn't one of the standard options still shows in the select.
  const pageSizeOptions = useMemo(() => {
    const options = new Set<number>(PAGE_SIZE_OPTIONS);
    if (typeof pageSize === "number") options.add(pageSize);
    if (typeof defaultPageSize === "number") options.add(defaultPageSize);
    return [...options].sort((a, b) => a - b);
  }, [pageSize, defaultPageSize]);

  // Totals by column key, computed once per (filtered) result set rather than
  // once per render — this walks every row, and the grid re-renders on every
  // keystroke in the search box.
  const footerResults = useMemo(() => {
    const results = new Map<string, number | null>();
    for (const column of visibleColumns) {
      if (!column.aggregate || !column.value) continue;
      results.set(column.key, aggregate(sortedRows.map((row) => column.value!(row)), column.aggregate));
    }
    return results;
  }, [visibleColumns, sortedRows]);
  const showFooterRow = footerResults.size > 0;

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
    setLayout((current) => ({
      ...current,
      order: orderedColumns.map((column) => column.key),
      hidden: [...hidden],
    }));
  }

  function moveColumn(key: string, offset: -1 | 1) {
    const order = orderedColumns.map((column) => column.key);
    const index = order.indexOf(key);
    const target = index + offset;
    if (index === -1 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    setLayout((current) => ({ ...current, order }));
  }

  /** Back to auto-sized, default-ordered, all-visible columns. */
  function resetColumns() {
    setLayout({ order: [], hidden: [], widths: {} });
  }

  /**
   * Current rendered width of every column, read from the DOM. Captured when a
   * drag starts so the whole table switches to fixed widths at exactly the sizes
   * it already had — without this, pinning one column would visibly re-flow the
   * others.
   */
  function measureColumnWidths(): Record<string, number> {
    const widths: Record<string, number> = {};
    const headers = tableRef.current?.querySelectorAll<HTMLTableCellElement>("th[data-column-key]");
    headers?.forEach((header) => {
      const key = header.dataset.columnKey;
      if (key) widths[key] = header.offsetWidth;
    });
    return widths;
  }

  function beginResize(event: ReactPointerEvent<HTMLElement>, column: DataGridColumn<T>) {
    // Stop the header's own click handler from also sorting the column.
    event.preventDefault();
    event.stopPropagation();
    const measured = measureColumnWidths();
    resizeStart.current = {
      key: column.key,
      startX: event.clientX,
      baseWidths: { ...measured, ...layout.widths },
    };
    setResizingKey(column.key);
  }

  useEffect(() => {
    if (!resizingKey) return;

    function handleMove(event: PointerEvent) {
      const start = resizeStart.current;
      if (!start) return;
      const column = columns.find((candidate) => candidate.key === start.key);
      const minWidth = column?.minWidth ?? DEFAULT_MIN_COLUMN_WIDTH;
      const nextWidth = Math.max(minWidth, (start.baseWidths[start.key] ?? minWidth) + (event.clientX - start.startX));
      setLayout((current) => ({
        ...current,
        widths: { ...start.baseWidths, ...current.widths, [start.key]: nextWidth },
      }));
    }

    function handleUp() {
      resizeStart.current = null;
      setResizingKey(undefined);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [resizingKey, columns]);

  /** Double-clicking a resize handle releases that column back to auto width. */
  function clearColumnWidth(key: string) {
    setLayout((current) => {
      if (current.widths[key] === undefined) return current;
      const widths = { ...current.widths };
      delete widths[key];
      return { ...current, widths };
    });
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

  const leadingColumnCount = (enableSelection ? 1 : 0) + (enableRecordView ? 1 : 0);
  const columnCount = visibleColumns.length + leadingColumnCount;
  const pad = densityClasses[density];
  const headerCellClass = `relative z-10 border border-line bg-brass-soft ${pad.header} text-center font-bold text-brass-dark shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_3px_5px_-1px_rgba(0,0,0,0.45)] ${
    stickyHeader ? "sticky top-0" : ""
  }`;

  // Fixed layout only once something has actually been resized, so grids nobody
  // has dragged keep sizing themselves to their content exactly as before.
  const hasCustomWidths = Object.keys(layout.widths).length > 0;

  const hasToolbar =
    showSearch || enableColumnFilters || enableColumnPicker || enableDensity || enableSelection;

  const recordRow = recordIndex !== undefined ? sortedRows[recordIndex] : undefined;
  const recordColumns = orderedColumns.filter((column) => !column.excludeFromRecordView);

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
          {enableDensity && (
            <label className="flex items-center gap-1 text-xs text-muted">
              <span>Rows</span>
              <select
                value={density}
                onChange={(event) => setDensity(event.target.value as Density)}
                aria-label="Row height"
                className={CONTROL_CLASS}
              >
                <option value="compact">Compact</option>
                <option value="normal">Normal</option>
                <option value="comfortable">Comfortable</option>
              </select>
            </label>
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
          {enableColumnResize && (
            <p className="mt-2 text-xs text-muted">
              Drag a column&apos;s right edge to resize it; double-click the edge to size it to
              content again.
            </p>
          )}
        </div>
      )}

      <div className="overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
        <table
          ref={tableRef}
          className={`w-full border-collapse text-sm ${hasCustomWidths ? "table-fixed" : ""}`}
        >
          {hasCustomWidths && (
            <colgroup>
              {enableSelection && <col style={{ width: "2.5rem" }} />}
              {enableRecordView && <col style={{ width: "2.5rem" }} />}
              {visibleColumns.map((column) => (
                <col
                  key={column.key}
                  style={layout.widths[column.key] ? { width: `${layout.widths[column.key]}px` } : undefined}
                />
              ))}
            </colgroup>
          )}
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
              {enableRecordView && (
                <th className={`${headerCellClass} w-10`}>
                  <span className="sr-only">View record</span>
                </th>
              )}
              {visibleColumns.map((column) => {
                const isSortable = column.value !== undefined && column.sortable !== false;
                const activeSort = sort?.columnKey === column.key ? sort.direction : undefined;
                return (
                  <th
                    key={column.key}
                    data-column-key={column.key}
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
                    {enableColumnResize && (
                      // Sits on the column's right edge, above the header's own
                      // click-to-sort target. `tabIndex={-1}` keeps it out of the
                      // tab order — tabbing through one of these per column would
                      // bury the controls that matter — while still being a real
                      // button rather than a div with handlers on it.
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-label={`Resize ${column.header}`}
                        title={`Drag to resize ${column.header}; double-click to fit content`}
                        onPointerDown={(event) => beginResize(event, column)}
                        onClick={(event) => event.stopPropagation()}
                        onDoubleClick={(event) => {
                          event.stopPropagation();
                          clearColumnWidth(column.key);
                        }}
                        className={`absolute inset-y-0 right-0 z-20 w-1.5 cursor-col-resize touch-none hover:bg-brass/40 ${
                          resizingKey === column.key ? "bg-brass/60" : ""
                        }`}
                      />
                    )}
                  </th>
                );
              })}
            </tr>
            {showFilterRow && enableColumnFilters && (
              <tr>
                {enableSelection && <th className="border border-line bg-paper px-2 py-1" />}
                {enableRecordView && <th className="border border-line bg-paper px-2 py-1" />}
                {visibleColumns.map((column) => (
                  <th key={column.key} className="border border-line bg-paper px-2 py-1">
                    {column.value ? (
                      <input
                        type="text"
                        value={columnFilters[column.key] ?? ""}
                        onChange={(event) => updateColumnFilter(column.key, event.target.value)}
                        placeholder="Filter…"
                        aria-label={`Filter by ${column.header}`}
                        title="Contains by default. Also: >100, <=50, 100..200, =exact, !=exclude"
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
                        className={`border border-line ${pad.cell} text-center`}
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
                    {enableRecordView && (
                      <td
                        className={`border border-line ${pad.cell} text-center`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => setRecordIndex(slice.startIndex + index)}
                          aria-label="View this record"
                          title="View this record"
                          className="rounded-md p-1 text-brass-dark transition-colors hover:bg-brass-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
                        >
                          <RecordViewIcon />
                        </button>
                      </td>
                    )}
                    {visibleColumns.map((column) => (
                      <td
                        key={column.key}
                        className={`border border-line ${pad.cell} text-ink ${column.className ?? ""}`}
                      >
                        {column.render(row)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
          {showFooterRow && (
            // Totals cover the filtered set across every page, matching what
            // Export CSV writes out — not just the page on screen.
            <tfoot>
              <tr>
                {enableSelection && (
                  <td className={`border border-line bg-brass-soft ${pad.cell}`} />
                )}
                {enableRecordView && (
                  <td className={`border border-line bg-brass-soft ${pad.cell}`} />
                )}
                {visibleColumns.map((column) => {
                  const kind = column.aggregate;
                  const result = footerResults.get(column.key) ?? null;
                  return (
                    <td
                      key={column.key}
                      className={`border border-line bg-brass-soft ${pad.cell} font-semibold text-brass-dark ${
                        column.className ?? ""
                      }`}
                    >
                      {kind && (
                        <span className="inline-flex items-baseline gap-1">
                          <span className="text-xs font-normal opacity-70">{aggregateLabels[kind]}</span>
                          {result === null
                            ? "—"
                            : (column.formatAggregate?.(result) ?? result.toLocaleString())}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {showStatusBar && (
        /* Raised status bar: a top highlight plus a cast shadow lifts it off the
           table, the same bevel mechanic the header bar uses (rather than the
           recessed inset it had before). */
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
                  {pageSizeOptions.map((option) => (
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
      )}

      {recordRow !== undefined && recordIndex !== undefined && (
        <Modal
          title={recordViewTitle?.(recordRow) ?? "Record"}
          description={`Record ${recordIndex + 1} of ${total.toLocaleString()}`}
          onClose={() => setRecordIndex(undefined)}
          footer={
            <>
              <Button
                size="sm"
                variant="secondary"
                disabled={recordIndex === 0}
                onClick={() => setRecordIndex((current) => Math.max(0, (current ?? 0) - 1))}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={recordIndex >= total - 1}
                onClick={() => setRecordIndex((current) => Math.min(total - 1, (current ?? 0) + 1))}
              >
                Next
              </Button>
              <Button size="sm" onClick={() => setRecordIndex(undefined)}>
                Close
              </Button>
            </>
          }
        >
          {/* Every column, including ones hidden in the grid — the point of the
              record view is to see the whole record without unhiding anything. */}
          <dl className="flex flex-col gap-px">
            {recordColumns.map((column) => (
              <div
                key={column.key}
                className="grid grid-cols-1 gap-1 border-b border-line py-2 last:border-b-0 sm:grid-cols-[12rem_1fr] sm:gap-3"
              >
                <dt className="text-xs font-medium uppercase tracking-wide text-muted">
                  {column.header}
                  {hiddenKeys.has(column.key) && (
                    <span className="ml-1 normal-case opacity-70">(hidden)</span>
                  )}
                </dt>
                <dd className="break-words text-sm text-ink">{column.render(recordRow)}</dd>
              </div>
            ))}
          </dl>
        </Modal>
      )}

      {showSqlDialog && (
        <Modal
          title="SQL Query"
          onClose={() => setShowSqlDialog(false)}
          isBusy={isRunningSql}
          footer={
            <>
              <Button variant="secondary" onClick={() => setShowSqlDialog(false)} disabled={isRunningSql}>
                Cancel
              </Button>
              <Button onClick={handleRunSql} disabled={isRunningSql || sqlDraft.trim() === ""}>
                {isRunningSql ? "Running…" : "OK"}
              </Button>
            </>
          }
        >
          <textarea
            value={sqlDraft}
            onChange={(event) => setSqlDraft(event.target.value)}
            rows={10}
            aria-label="SQL query"
            className="w-full rounded-md border border-line bg-paper px-3 py-2 font-mono text-xs text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          />
        </Modal>
      )}
    </div>
  );
}
