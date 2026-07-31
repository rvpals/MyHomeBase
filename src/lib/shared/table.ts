// Pure table mechanics — comparing, sorting, filtering, and paginating rows.
// Extracted from the DataGrid component so the fiddly parts (null ordering,
// numeric-aware comparison, multi-term search) are unit-testable without a
// render harness. No React, no DOM: these take data and return data.

/** The primitive a cell contributes to sorting, filtering, and CSV export. */
export type CellValue = string | number | null;

export type SortDirection = "asc" | "desc";

/**
 * Orders two cell values. Nulls sort last regardless of direction (they're
 * "no data", not a smallest value). Numbers compare numerically; everything else
 * compares as text with `numeric: true`, so "item 2" precedes "item 10".
 */
export function compareValues(a: CellValue, b: CellValue): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

/**
 * Returns a new array sorted by `accessor` — the input is never mutated, since
 * the caller's row array is owned by React state.
 */
export function sortRows<T>(
  rows: T[],
  accessor: (row: T) => CellValue,
  direction: SortDirection,
): T[] {
  const factor = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => compareValues(accessor(a), accessor(b)) * factor);
}

function toSearchText(value: CellValue): string {
  return value === null ? "" : String(value).toLowerCase();
}

/**
 * True when every whitespace-separated term in `query` appears in at least one
 * of `values`. Terms are ANDed so typing "smith invoice" narrows rather than
 * widens; matching is case-insensitive substring. A blank query matches
 * everything.
 */
export function matchesSearch(values: CellValue[], query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystacks = values.map(toSearchText);
  return terms.every((term) => haystacks.some((haystack) => haystack.includes(term)));
}

/** True when `value` contains `filter` (case-insensitive). Blank filters match everything. */
export function matchesFilter(value: CellValue, filter: string): boolean {
  const needle = filter.trim().toLowerCase();
  if (needle === "") return true;
  return toSearchText(value).includes(needle);
}

export interface PageSlice {
  /** 0-based page index, clamped to the available pages. */
  page: number;
  totalPages: number;
  /** Index of the first visible row within the full (filtered) set. */
  startIndex: number;
  /** Exclusive end index. */
  endIndex: number;
}

/**
 * Works out which slice of `total` rows to show. `pageSize` of "ALL" collapses to
 * a single page. The requested page is clamped, so shrinking the result set (by
 * filtering, say) can't leave the view stranded past the last page.
 */
export function computePageSlice(total: number, pageSize: number | "ALL", page: number): PageSlice {
  if (pageSize === "ALL" || total === 0) {
    return { page: 0, totalPages: 1, startIndex: 0, endIndex: total };
  }
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const startIndex = safePage * pageSize;
  return {
    page: safePage,
    totalPages,
    startIndex,
    endIndex: Math.min(startIndex + pageSize, total),
  };
}

/** Escapes one value for CSV, quoting only when the text needs it. */
export function toCsvField(value: CellValue): string {
  const text = value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Joins rows of already-stringified cells into CSV text with CRLF line endings. */
export function toCsv(header: string[], rows: CellValue[][]): string {
  const lines = [header.map(toCsvField).join(",")];
  for (const row of rows) lines.push(row.map(toCsvField).join(","));
  return lines.join("\r\n");
}
