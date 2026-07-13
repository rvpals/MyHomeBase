// Reusable tabular grid. Pure presentation: props in, events out.
// No data fetching, no business logic — the page that fetched the rows
// passes them in, and each column's `render` decides how to draw a cell
// (including any per-row action buttons).

import type { ReactNode } from "react";

export interface DataGridColumn<T> {
  /** Unique key for this column, used as the React key for its header/cell. */
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Extra classes for both the header and body cells in this column. */
  className?: string;
}

export interface DataGridProps<T> {
  columns: DataGridColumn<T>[];
  rows: T[];
  /** Stable identity for each row, used as the React key. */
  getRowKey: (row: T) => string | number;
  /** Shown instead of the table body when `rows` is empty. */
  emptyMessage?: string;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

export function DataGrid<T>({
  columns,
  rows,
  getRowKey,
  emptyMessage = "No rows to show.",
  className = "",
}: DataGridProps<T>) {
  return (
    <div className={`overflow-x-auto rounded-xl border border-line ${className}`}>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line bg-paper-raised">
            {columns.map((column) => (
              <th
                key={column.key}
                className={`px-4 py-2.5 font-medium text-muted ${column.className ?? ""}`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-8 text-center text-muted">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={getRowKey(row)} className="border-b border-line last:border-b-0">
                {columns.map((column) => (
                  <td key={column.key} className={`px-4 py-2.5 text-ink ${column.className ?? ""}`}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
