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

/**
 * What a filter box's text means. `contains` is the fallback, so any text that
 * isn't recognised as an operator keeps behaving exactly as it always has.
 */
export type FilterExpression =
  | { kind: "all" }
  | { kind: "contains"; text: string }
  | { kind: "eq" | "ne"; text: string }
  | { kind: "gt" | "gte" | "lt" | "lte"; bound: CellValue }
  | { kind: "range"; from: CellValue; to: CellValue };

/** `12`, `-4.5`, `1,200` -> a number; anything else -> undefined. */
function toNumber(text: string): number | undefined {
  const cleaned = text.replace(/,/g, "").trim();
  if (cleaned === "") return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * A comparison bound is compared numerically when it looks like a number, and as
 * text otherwise — which is what makes `>2026-07-01` work on ISO dates for free
 * (they sort lexicographically) without the filter needing to know about dates.
 */
function toBound(text: string): CellValue {
  return toNumber(text) ?? text.trim().toLowerCase();
}

/**
 * Reads a filter box's text as a comparison.
 *
 * Recognised, in precedence order: `>=`/`<=`/`>`/`<` comparisons, `!=`
 * exclusion, `=` exact match, and `from..to` ranges (inclusive at both ends).
 * Everything else — including a lone `>` with nothing after it, so the
 * expression stays sane mid-typing — is a case-insensitive substring match.
 *
 * Bounds are numeric when they parse as numbers, textual otherwise, so `>100`
 * filters an amount column and `>=2026-07-01` filters an ISO date column.
 */
export function parseFilterExpression(filter: string): FilterExpression {
  const text = filter.trim();
  if (text === "") return { kind: "all" };
  // Operator characters with no operand yet — the state every one of these
  // filters passes through as it's typed. Matching everything keeps the grid
  // full until there's something to compare against; treating it as a substring
  // would blank the grid on the first keystroke.
  if (/^[><=!.]+$/.test(text)) return { kind: "all" };

  const comparison = /^(>=|<=|>|<)\s*(.+)$/.exec(text);
  if (comparison) {
    const kind = ({ ">": "gt", ">=": "gte", "<": "lt", "<=": "lte" } as const)[
      comparison[1] as ">" | ">=" | "<" | "<="
    ];
    return { kind, bound: toBound(comparison[2]) };
  }

  const negation = /^!=\s*(.+)$/.exec(text);
  if (negation) return { kind: "ne", text: negation[1].trim().toLowerCase() };

  const exact = /^=\s*(.+)$/.exec(text);
  if (exact) return { kind: "eq", text: exact[1].trim().toLowerCase() };

  // Guard against a decimal being read as a range: "1.5" has a single dot.
  const range = /^(.*?)\.\.(.*)$/.exec(text);
  if (range && (range[1].trim() !== "" || range[2].trim() !== "")) {
    return { kind: "range", from: toBound(range[1]), to: toBound(range[2]) };
  }

  return { kind: "contains", text: text.toLowerCase() };
}

/**
 * Orders a cell against a filter bound. Both are coerced to numbers when both
 * look numeric, so a numeric column compares numerically even though the filter
 * arrived as text; otherwise it's a locale text comparison.
 */
function compareToBound(value: CellValue, bound: CellValue): number | undefined {
  if (value === null) return undefined; // "no data" never satisfies a comparison
  const valueNumber = typeof value === "number" ? value : toNumber(String(value));
  const boundNumber = typeof bound === "number" ? bound : toNumber(String(bound));
  if (valueNumber !== undefined && boundNumber !== undefined) return valueNumber - boundNumber;
  return String(value).toLowerCase().localeCompare(String(bound).toLowerCase(), undefined, {
    numeric: true,
  });
}

/**
 * True when `value` satisfies `filter`. Blank filters match everything.
 *
 * Plain text is a case-insensitive substring match — the long-standing
 * behaviour — with `>`, `>=`, `<`, `<=`, `!=`, `=` and `from..to` also
 * understood (see `parseFilterExpression`). An open-ended range (`100..` or
 * `..100`) constrains only the end that was given.
 */
export function matchesFilter(value: CellValue, filter: string): boolean {
  const expression = parseFilterExpression(filter);

  switch (expression.kind) {
    case "all":
      return true;
    case "contains":
      return toSearchText(value).includes(expression.text);
    case "eq":
      return toSearchText(value) === expression.text;
    case "ne":
      return toSearchText(value) !== expression.text;
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const order = compareToBound(value, expression.bound);
      if (order === undefined) return false;
      if (expression.kind === "gt") return order > 0;
      if (expression.kind === "gte") return order >= 0;
      if (expression.kind === "lt") return order < 0;
      return order <= 0;
    }
    case "range": {
      const hasFrom = String(expression.from).trim() !== "";
      const hasTo = String(expression.to).trim() !== "";
      if (hasFrom) {
        const order = compareToBound(value, expression.from);
        if (order === undefined || order < 0) return false;
      }
      if (hasTo) {
        const order = compareToBound(value, expression.to);
        if (order === undefined || order > 0) return false;
      }
      return true;
    }
  }
}

/** The rollups a column footer can show. */
export const AGGREGATE_KINDS = ["sum", "avg", "min", "max", "count"] as const;

export type AggregateKind = (typeof AGGREGATE_KINDS)[number];

/**
 * Rolls a column's values up to one number, or null when there's nothing to
 * report.
 *
 * Nulls are skipped rather than counted as zero — averaging a column with gaps
 * shouldn't be dragged toward zero by the gaps. `count` counts the non-null
 * values for the same reason. `sum`/`avg`/`min`/`max` only consider values that
 * parse as numbers, so a stray "n/a" in an otherwise numeric column is ignored
 * instead of poisoning the total with NaN.
 */
export function aggregate(values: CellValue[], kind: AggregateKind): number | null {
  if (kind === "count") return values.filter((value) => value !== null).length;

  const numbers = values
    .map((value) => (typeof value === "number" ? value : toNumber(String(value ?? ""))))
    .filter((value): value is number => value !== undefined);
  if (numbers.length === 0) return null;

  switch (kind) {
    case "sum":
      return numbers.reduce((total, value) => total + value, 0);
    case "avg":
      return numbers.reduce((total, value) => total + value, 0) / numbers.length;
    case "min":
      return Math.min(...numbers);
    case "max":
      return Math.max(...numbers);
  }
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
