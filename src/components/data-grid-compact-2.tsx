"use client";

// `DataGrid`'s other compact layout, alongside `DataGridCompact`.
//
// `DataGridCompact` renders every row as its own card, so a page of results is a
// vertical stack you scroll through. This takes the opposite bet: **one record on
// screen at a time, read in full.** The records in the current page become tabs
// across the top of a single container; the panel below shows the selected record
// as a two-column field/value read-out with every column present and nothing
// truncated.
//
// The trade is deliberate. A stack of cards is better for scanning ("which of
// these forty rows do I want?"); this is better for reading ("what does this one
// record actually say?"), because a card that has to fit fifteen fields ends up
// truncating most of them. Which of the two is right depends on the grid, which is
// why this ships alongside `DataGridCompact` rather than replacing it.
//
// **Callers never choose this directly** — they pass `compactLayout="record"` to
// `DataGrid`, which delegates here when the layout is compact. The default is
// still `"cards"`, so no existing grid changes shape.
//
// The subset is smaller again than `DataGridCompact`'s: sort yes, search and
// selection no. Selection is the structural exclusion — ticking boxes across a
// list you can only see one row of at a time is the wrong interaction, so grids
// with bulk actions stay on `"cards"`.

import { useMemo, useState, type ReactNode } from "react";
import type { CellValue, DataGridColumn } from "./data-grid";

export interface DataGridCompact2Props<T> {
  columns: DataGridColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string | number;
  emptyMessage?: string;
  /**
   * Rendered as a button under the record when set — the compact stand-in for the
   * full grid's clickable row. Without it the panel is read-only.
   */
  onRowClick?: (row: T) => void;
  /** Label for that button. Default "Open record". */
  openLabel?: string;
  /**
   * Show the "Sort by" control above the container. Default true.
   *
   * Sort matters more here than in the card stack: only one record is on screen,
   * so **record order is the only way to navigate**. Without it, "find last
   * Tuesday's entry" means paging blind through numbered tabs.
   */
  enableSort?: boolean;
  className?: string;
}

/**
 * Records per page, which is also the number of tabs in the strip.
 *
 * Five, not ten: a 390px phone leaves roughly 360px of usable width inside the
 * card, so five tabs get ~68px each — enough for a legible label. Ten would be
 * ~34px, which fits a bare digit and wraps to a second row the moment it doesn't.
 */
const PAGE_SIZE = 5;

/**
 * Field name / value split.
 *
 * Both sides wrap rather than truncate — the whole point of this layout is that a
 * record is readable in full, so a long field name growing to three lines is the
 * correct outcome, not a bug. `minmax(0,…)` on both tracks is what allows the
 * wrap: without it a long unbroken value would force the column wider than the
 * card instead of breaking.
 */
const FIELD_GRID_CLASS = "grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3 gap-y-0";

const CONTROL_CLASS =
  "rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

function compareValues(a: CellValue, b: CellValue): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a ?? "").localeCompare(String(b ?? ""));
}

export function DataGridCompact2<T>({
  columns,
  rows,
  getRowKey,
  emptyMessage = "Nothing to show.",
  onRowClick,
  openLabel = "Open record",
  enableSort = true,
  className = "",
}: DataGridCompact2Props<T>) {
  const [pageIndex, setPageIndex] = useState(0);
  const [activeInPage, setActiveInPage] = useState(0);
  const [sortKey, setSortKey] = useState("");

  const sortableColumns = enableSort
    ? columns.filter((column) => column.value && column.sortable !== false)
    : [];

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const column = columns.find((candidate) => candidate.key === sortKey);
    if (!column?.value) return rows;
    // Copied before sorting: `rows` is the caller's array and must not be
    // reordered underneath them.
    return [...rows].sort((a, b) => compareValues(column.value!(a), column.value!(b)));
  }, [rows, columns, sortKey]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));

  // Rows are the caller's and can shrink under us — an entry deleted, a filter
  // applied upstream — leaving `pageIndex` past the end. Derived during render
  // rather than corrected in an effect: an effect would render once with an
  // out-of-range page, then set state to re-render, which is the cascading
  // update `react-hooks/set-state-in-effect` warns about. Clamping here means
  // there is never a frame showing the invalid page.
  const page = Math.min(pageIndex, pageCount - 1);

  const pageRows = useMemo(
    () => sorted.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [sorted, page],
  );

  // The last page is usually short, so the active tab can point past its end.
  const activeIndex = Math.min(activeInPage, Math.max(0, pageRows.length - 1));
  const activeRow = pageRows[activeIndex];

  // The first column identifies the record, so it heads the panel instead of
  // being another field/value line further down.
  const [leadColumn, ...detailColumns] = columns;

  function goToPage(next: number) {
    setPageIndex(next);
    setActiveInPage(0);
  }

  if (!leadColumn) return null;

  if (sorted.length === 0) {
    return (
      <div className={`rounded-xl border border-line bg-paper-raised p-6 ${className}`}>
        <p className="text-center text-sm text-muted">{emptyMessage}</p>
      </div>
    );
  }

  const firstShown = page * PAGE_SIZE + 1;
  const lastShown = page * PAGE_SIZE + pageRows.length;

  return (
    <div className={className}>
      {sortableColumns.length > 0 && (
        // Above the container, not inside it: the container is one record, and a
        // control that reorders the whole set doesn't belong within the thing it
        // reorders. Changing the order also sends you back to record 1, since the
        // tab you were on refers to a position that now holds something else.
        <label className="mb-2 flex items-center gap-2 text-sm text-muted">
          Sort by
          <select
            value={sortKey}
            onChange={(event) => {
              setSortKey(event.target.value);
              goToPage(0);
            }}
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

      <div
        data-compact2-container
        className="overflow-hidden rounded-xl border border-line bg-paper-raised"
      >
        {/* One tab per record in this page. Labelled by position rather than by the
            record's own value: a date or a title doesn't fit 68px, and truncating it
            gives a strip of ambiguous stubs. The lead value heads the panel instead,
            where it has the full width. */}
        <div role="tablist" aria-label="Records on this page" className="flex border-b border-line">
          {pageRows.map((row, index) => {
            const isActive = index === activeIndex;
            return (
              <button
                key={getRowKey(row)}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveInPage(index)}
                className={`flex-1 border-r border-line py-2 text-sm font-medium last:border-r-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brass ${
                  isActive
                    ? "bg-paper text-brass-dark"
                    : "text-muted hover:bg-paper/50 hover:text-ink"
                }`}
              >
                {page * PAGE_SIZE + index + 1}
              </button>
            );
          })}
        </div>

        {activeRow !== undefined && (
          <div data-compact2-record className="p-3">
            <div className="font-display text-base text-ink [overflow-wrap:anywhere]">
              {leadColumn.render(activeRow)}
            </div>

            <dl className={`mt-3 ${FIELD_GRID_CLASS}`}>
              {detailColumns.map((column) => (
                // Each pair is its own two-cell row of the grid, separated by a
                // hairline so a wrapped value stays visually attached to its name.
                <div
                  key={column.key}
                  className="col-span-2 grid grid-cols-subgrid border-t border-line/60 py-1.5"
                >
                  <dt className="text-xs uppercase tracking-wide text-muted [overflow-wrap:anywhere]">
                    {column.header}
                  </dt>
                  <dd className="text-sm text-ink [overflow-wrap:anywhere]">
                    {column.render(activeRow)}
                  </dd>
                </div>
              ))}
            </dl>

            {onRowClick !== undefined && (
              <button
                type="button"
                onClick={() => onRowClick(activeRow)}
                className="mt-3 w-full rounded-lg border border-line px-3 py-2 text-sm font-medium text-brass-dark hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
              >
                {openLabel}
              </button>
            )}
          </div>
        )}

        {/* Pagination lives inside the container, per the layout's brief: the card
            is the whole widget, not just the record. */}
        <div className="flex items-center justify-between gap-2 border-t border-line bg-paper/40 p-2">
          <PagerButton onClick={() => goToPage(page - 1)} disabled={page === 0}>
            &lsaquo; Prev
          </PagerButton>
          <p className="min-w-0 flex-1 text-center text-xs text-muted">
            {firstShown}&ndash;{lastShown} of {sorted.length}
          </p>
          <PagerButton
            onClick={() => goToPage(page + 1)}
            disabled={page >= pageCount - 1}
          >
            Next &rsaquo;
          </PagerButton>
        </div>
      </div>
    </div>
  );
}

function PagerButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-brass-dark disabled:cursor-not-allowed disabled:border-line/50 disabled:text-muted/50 enabled:hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
    >
      {children}
    </button>
  );
}
