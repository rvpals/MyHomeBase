"use client";

// The compact-layout counterpart to `DataGrid`. One card per row instead of a table.
//
// Not a narrower table — a different shape. The Positions grid is **1498px wide**;
// on a 390px phone that is four screens of horizontal dragging to read one row,
// and no amount of restyling fixes it, because a table's whole premise is that
// columns line up across rows and there is room for them to.
//
// A card drops that premise: each row becomes a stack of label/value pairs, led
// by the first column (the one that identifies the record — a ticker, a date, a
// payee). Reading one record is now vertical scrolling, which a phone is good at.
//
// **Callers never choose this.** `DataGrid` delegates here when the layout is
// compact, so every grid in the app gets it without touching a single call site.
// It deliberately implements a *subset*: search, sort, row actions and selection,
// which are what a phone is used for. Column reordering, resizing, per-column filters,
// CSV export and density belong to a pointer and a wide screen — they stay on the full
// layout rather than being crammed in.
//
// Selection is here rather than being one of the omissions, because a bulk action is
// not a wide-screen luxury: leaving it out silently dropped "Download" and "Remove
// from favorites" below 1024px, so a phone could see the list and not act on it. It is
// implemented as a checkbox in each card's top-right and the caller's action bar
// pinned above the cards.

import { useMemo, useState, type ReactNode } from "react";
import type { CellValue, DataGridColumn } from "./data-grid";

export interface DataGridCompactProps<T> {
  columns: DataGridColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string | number;
  emptyMessage?: string;
  /** Show the controls row above the cards (search + Sort by). Default true. */
  showToolbar?: boolean;
  enableSearch?: boolean;
  onRowClick?: (row: T) => void;
  /** Add a checkbox to each card. Default false. */
  enableSelection?: boolean;
  /** Rendered above the cards while rows are selected — the caller's bulk actions. */
  renderSelectionActions?: (selectedRows: T[], clearSelection: () => void) => ReactNode;
  className?: string;
}

const CONTROL_CLASS =
  "rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/**
 * Cards rendered before the "show more" button appears.
 *
 * The full grid paginates; this doesn't, and without a cap a few thousand
 * expense rows would become a few thousand cards — a long freeze on exactly the
 * hardware least able to absorb it. Growing on demand keeps the common case
 * (glance at the newest rows) instant while leaving everything reachable.
 */
const PAGE_STEP = 50;

/** Lower-cased text of a cell's sortable value, for the search box. */
function searchableText<T>(row: T, columns: DataGridColumn<T>[]): string {
  return columns
    .map((column) => column.value?.(row))
    .filter((value): value is CellValue => value != null)
    .join(" ")
    .toLowerCase();
}

function compareValues(a: CellValue, b: CellValue): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a ?? "").localeCompare(String(b ?? ""));
}

export function DataGridCompact<T>({
  columns,
  rows,
  getRowKey,
  emptyMessage = "Nothing to show.",
  showToolbar = true,
  enableSearch = true,
  onRowClick,
  enableSelection = false,
  renderSelectionActions,
  className = "",
}: DataGridCompactProps<T>) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<string>("");
  const [limit, setLimit] = useState(PAGE_STEP);
  const [selectedKeys, setSelectedKeys] = useState<Set<string | number>>(new Set());

  // The first column identifies the record, so it becomes the card's heading
  // rather than another label/value line.
  const [leadColumn, ...detailColumns] = columns;
  const sortableColumns = showToolbar
    ? columns.filter((column) => column.value && column.sortable !== false)
    : [];
  const showSearch = showToolbar && enableSearch;

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? rows.filter((row) => searchableText(row, columns).includes(needle))
      : rows;

    if (!sortKey) return filtered;
    const column = columns.find((candidate) => candidate.key === sortKey);
    if (!column?.value) return filtered;
    // Copied before sorting: `rows` is the caller's array and must not be
    // reordered underneath them.
    return [...filtered].sort((a, b) => compareValues(column.value!(a), column.value!(b)));
  }, [rows, columns, query, sortKey]);

  // Selection is always a subset of what the search currently shows, so the count in
  // the action bar equals what a bulk action will touch — the same contract the full
  // grid keeps. A row filtered out of view is dropped from the selection rather than
  // acted on invisibly.
  const selectedRows = visible.filter((row) => selectedKeys.has(getRowKey(row)));
  const clearSelection = () => setSelectedKeys(new Set());
  const allVisibleSelected = visible.length > 0 && selectedRows.length === visible.length;

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
      if (allVisibleSelected) for (const row of visible) next.delete(getRowKey(row));
      else for (const row of visible) next.add(getRowKey(row));
      return next;
    });
  }

  if (!leadColumn) return null;

  return (
    <div className={className}>
      {(showSearch || sortableColumns.length > 0) && (
        <div className="mb-3 flex flex-col gap-2">
          {showSearch && (
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search…"
              aria-label="Search"
              className={`w-full ${CONTROL_CLASS}`}
            />
          )}
          {sortableColumns.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-muted">
              Sort by
              <select
                value={sortKey}
                onChange={(event) => setSortKey(event.target.value)}
                className={`flex-1 ${CONTROL_CLASS}`}
              >
                <option value="">Original order</option>
                {sortableColumns.map((column) => (
                  <option key={column.key} value={column.key}>
                    {column.header}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {enableSelection && visible.length > 0 && (
        // Always present, not only once something is selected: on a phone the "Select
        // all" control is the only way to act on a long list without tapping fifty
        // cards, and a bar that appears only after the first tap hides that.
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-paper-raised p-2">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleSelectAll}
              className="h-4 w-4 accent-brass"
            />
            {selectedRows.length > 0 ? `${selectedRows.length} selected` : "Select all"}
          </label>
          {selectedRows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {renderSelectionActions?.(selectedRows, clearSelection)}
              <button
                type="button"
                onClick={clearSelection}
                className="text-xs text-muted underline hover:text-ink"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">
          {rows.length === 0 ? emptyMessage : "Nothing matches that search."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.slice(0, limit).map((row) => (
            <li key={getRowKey(row)}>
              <CompactRow
                row={row}
                leadColumn={leadColumn}
                detailColumns={detailColumns}
                onRowClick={onRowClick}
                isSelectable={enableSelection}
                isSelected={selectedKeys.has(getRowKey(row))}
                onToggleSelected={() => toggleRowSelection(row)}
              />
            </li>
          ))}
        </ul>
      )}

      {visible.length > limit && (
        <button
          type="button"
          onClick={() => setLimit((current) => current + PAGE_STEP)}
          className="mt-3 w-full rounded-lg border border-line px-3 py-2 text-sm font-medium text-brass-dark hover:bg-paper-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        >
          Show {Math.min(PAGE_STEP, visible.length - limit)} more
        </button>
      )}

      <p className="mt-3 text-xs text-muted">
        Showing {Math.min(limit, visible.length)} of {visible.length}
        {visible.length !== rows.length && ` (filtered from ${rows.length})`}.
      </p>
    </div>
  );
}

function CompactRow<T>({
  row,
  leadColumn,
  detailColumns,
  onRowClick,
  isSelectable = false,
  isSelected = false,
  onToggleSelected,
}: {
  row: T;
  leadColumn: DataGridColumn<T>;
  detailColumns: DataGridColumn<T>[];
  onRowClick?: (row: T) => void;
  isSelectable?: boolean;
  isSelected?: boolean;
  onToggleSelected?: () => void;
}) {
  const body: ReactNode = (
    <>
      <div className="font-display text-base text-ink">{leadColumn.render(row)}</div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
        {detailColumns.map((column) => (
          <div key={column.key} className="min-w-0">
            <dt className="text-[11px] uppercase tracking-wide text-muted">{column.header}</dt>
            <dd className="truncate text-sm text-ink">{column.render(row)}</dd>
          </div>
        ))}
      </dl>
    </>
  );

  const cardClass = `rounded-xl border bg-paper-raised p-3 ${
    isSelected ? "border-brass" : "border-line"
  }`;

  // `data-compact-row` is a stable hook for the layout snapshot harness, which
  // counts cards the way it counts table rows.
  const card =
    onRowClick === undefined ? (
      <div data-compact-row className={cardClass}>
        {body}
      </div>
    ) : (
      <button
        type="button"
        data-compact-row
        onClick={() => onRowClick(row)}
        className={`w-full text-left transition-colors hover:border-brass/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${cardClass}`}
      >
        {body}
      </button>
    );

  if (!isSelectable) return card;

  // The checkbox is a SIBLING of the card, not a child of it. A clickable card is a
  // `<button>`, and an input inside a button is invalid HTML that browsers resolve by
  // swallowing the input's clicks — so the checkbox would render and refuse to tick.
  // Absolutely positioned over the card's top-right instead, which also keeps it clear
  // of the lead column's text.
  return (
    <div className="relative">
      {card}
      <label className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelected?.()}
          aria-label="Select row"
          className="h-4 w-4 accent-brass"
        />
      </label>
    </div>
  );
}
