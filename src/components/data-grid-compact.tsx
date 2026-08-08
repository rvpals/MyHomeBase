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
// It deliberately implements a *subset*: search, sort and row actions, which are
// what a phone is used for. Column reordering, resizing, per-column filters, CSV
// export and density belong to a pointer and a wide screen — they stay on the
// full layout rather than being crammed in.

import { useMemo, useState, type ReactNode } from "react";
import type { CellValue, DataGridColumn } from "./data-grid";

export interface DataGridCompactProps<T> {
  columns: DataGridColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string | number;
  emptyMessage?: string;
  enableSearch?: boolean;
  onRowClick?: (row: T) => void;
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
  enableSearch = true,
  onRowClick,
  className = "",
}: DataGridCompactProps<T>) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<string>("");
  const [limit, setLimit] = useState(PAGE_STEP);

  // The first column identifies the record, so it becomes the card's heading
  // rather than another label/value line.
  const [leadColumn, ...detailColumns] = columns;
  const sortableColumns = columns.filter((column) => column.value && column.sortable !== false);

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

  if (!leadColumn) return null;

  return (
    <div className={className}>
      {(enableSearch || sortableColumns.length > 0) && (
        <div className="mb-3 flex flex-col gap-2">
          {enableSearch && (
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
}: {
  row: T;
  leadColumn: DataGridColumn<T>;
  detailColumns: DataGridColumn<T>[];
  onRowClick?: (row: T) => void;
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

  // `data-compact-row` is a stable hook for the layout snapshot harness, which
  // counts cards the way it counts table rows.
  if (!onRowClick) {
    return (
      <div data-compact-row className="rounded-xl border border-line bg-paper-raised p-3">
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      data-compact-row
      onClick={() => onRowClick(row)}
      className="w-full rounded-xl border border-line bg-paper-raised p-3 text-left transition-colors hover:border-brass/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
    >
      {body}
    </button>
  );
}
