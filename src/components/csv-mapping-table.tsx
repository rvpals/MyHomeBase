"use client";

// The table you map a CSV's columns in: one column per CSV header, a field
// dropdown under each, an optional per-column options row, and sample data below
// so you can see what you're mapping.
//
// Pure presentation — it holds no mapping state. The caller owns `mapping` and
// `fieldOptions` and applies every change, because a mapping is domain data that
// gets saved, not view state.

import type { ReactNode } from "react";

const SMALL_INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-2 py-1 text-xs text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/** One selectable target field. */
export interface CsvMappingField {
  value: string;
  label: string;
}

export interface CsvMappingTableProps {
  /** CSV header cells, in file order. Their index is the mapping key. */
  headers: string[];
  /** Data rows to show under the mapping controls, as parsed (cells may be missing). */
  sampleRows: string[][];
  /** The fields a column may target. The "Ignore" option is added automatically. */
  fields: readonly CsvMappingField[];
  /** Column index (as a string) → target field. Columns absent from this map are ignored. */
  mapping: Record<string, string>;
  /** Raised when a column's field changes. An empty `field` means "ignore this column". */
  onMappingChange: (columnIndex: number, field: string) => void;
  /**
   * Extra control rendered beneath a mapped column's dropdown — a date-format box,
   * a delimiter box, whatever that field needs. Return `null` for fields with no
   * options, and the row collapses to empty for them. Omit to hide the row entirely.
   */
  renderFieldOptions?: (columnIndex: number, field: string) => ReactNode;
  /**
   * Row indexes (into `sampleRows`) the user has dropped. Supply this **and**
   * `onToggleRowExcluded` to turn on per-row exclusion; omit both and the table has
   * no row controls at all.
   */
  excludedRowIndexes?: ReadonlySet<number>;
  /** Raised when a row's remove/restore control is used. */
  onToggleRowExcluded?: (rowIndex: number) => void;
  /**
   * Shown in the row-number column's header. Only meaningful with exclusion on.
   * Defaults to "#".
   */
  rowNumberHeader?: string;
  /**
   * An extra column of the importer's own, rendered before the CSV's columns — for
   * a decision made per row at import time rather than read from the file (the
   * Stocks importer puts its per-row Type dropdown here). Omit for no extra column.
   */
  extraColumn?: {
    header: string;
    /** Optional control in the header cell, e.g. a "set all rows to…" picker. */
    renderHeaderControl?: () => ReactNode;
    renderCell: (rowIndex: number, row: string[]) => ReactNode;
  };
  className?: string;
}

export function CsvMappingTable({
  headers,
  sampleRows,
  fields,
  mapping,
  onMappingChange,
  renderFieldOptions,
  excludedRowIndexes,
  onToggleRowExcluded,
  rowNumberHeader = "#",
  extraColumn,
  className = "",
}: CsvMappingTableProps) {
  // Both halves are needed for a working control, so one missing turns the feature
  // off rather than rendering a button that does nothing.
  const canExclude = Boolean(excludedRowIndexes && onToggleRowExcluded);

  return (
    <div className={`overflow-auto rounded-md border border-line ${className}`}>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line bg-paper-raised">
            {canExclude && (
              <th className="px-3 py-2 font-medium text-muted" scope="col">
                {rowNumberHeader}
              </th>
            )}
            {extraColumn && (
              <th className="px-3 py-2 font-medium text-brass-dark" scope="col">
                {extraColumn.header}
              </th>
            )}
            {/* Keyed by index, not header text: broker exports do repeat a header
                (and ship blank ones), which would collide on a text key. */}
            {headers.map((header, index) => (
              <th key={index} className="px-3 py-2 font-medium text-muted">
                {header}
              </th>
            ))}
          </tr>
          <tr className="border-b border-line">
            {canExclude && <th className="px-3 py-2" aria-hidden />}
            {extraColumn && (
              <th className="px-3 py-2 align-top font-normal">
                {extraColumn.renderHeaderControl?.()}
              </th>
            )}
            {headers.map((_, index) => (
              <th key={index} className="px-3 py-2 align-top">
                <select
                  value={mapping[String(index)] ?? ""}
                  onChange={(event) => onMappingChange(index, event.target.value)}
                  aria-label={`Field for column ${headers[index] || index + 1}`}
                  className={SMALL_INPUT_CLASS}
                >
                  <option value="">Ignore</option>
                  {fields.map((field) => (
                    <option key={field.value} value={field.value}>
                      {field.label}
                    </option>
                  ))}
                </select>
              </th>
            ))}
          </tr>
          {renderFieldOptions && (
            <tr className="border-b border-line">
              {canExclude && <th className="px-3 py-2" aria-hidden />}
              {extraColumn && <th className="px-3 py-2" aria-hidden />}
              {headers.map((_, index) => (
                <th key={index} className="px-3 py-2 align-top font-normal">
                  {renderFieldOptions(index, mapping[String(index)] ?? "")}
                </th>
              ))}
            </tr>
          )}
        </thead>
        <tbody>
          {sampleRows.map((row, rowIndex) => {
            const isExcluded = Boolean(excludedRowIndexes?.has(rowIndex));
            return (
              <tr
                key={rowIndex}
                className={`border-b border-line align-top last:border-b-0 ${
                  isExcluded ? "opacity-40" : ""
                }`}
              >
                {canExclude && (
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className="mr-2 font-mono text-xs text-muted">{rowIndex + 1}</span>
                    <button
                      type="button"
                      onClick={() => onToggleRowExcluded?.(rowIndex)}
                      aria-pressed={isExcluded}
                      aria-label={
                        isExcluded ? `Restore row ${rowIndex + 1}` : `Remove row ${rowIndex + 1}`
                      }
                      title={isExcluded ? "Put this row back" : "Don't import this row"}
                      className={`text-xs font-medium ${
                        isExcluded ? "text-brass-dark hover:underline" : "text-muted hover:text-red-400"
                      }`}
                    >
                      {isExcluded ? "Undo" : "×"}
                    </button>
                  </td>
                )}
                {extraColumn && (
                  <td className="px-3 py-2">{extraColumn.renderCell(rowIndex, row)}</td>
                )}
                {/* Iterate the headers, not the row: a short row would otherwise
                    shift every later cell one column left. */}
                {headers.map((_, cellIndex) => (
                  <td
                    key={cellIndex}
                    className={`max-w-xs truncate px-3 py-2 text-ink ${
                      isExcluded ? "line-through" : ""
                    }`}
                    title={row[cellIndex] ?? ""}
                  >
                    {row[cellIndex] ?? ""}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The input styling the options row should use, so callers don't re-invent it. */
export const CSV_MAPPING_OPTION_INPUT_CLASS = SMALL_INPUT_CLASS;
