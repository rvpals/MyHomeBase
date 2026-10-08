// Domain models for Journal Reports. These are the shapes the rest of the app
// sees — the repository maps the flat jrn_reports / jrn_report_details rows into
// these and back.

/**
 * How a report decides which entries it covers.
 *
 * - `filter`: `whereQuery` holds the compact filter-query syntax, parsed by
 *   `parseFilterQuery` and compiled through the field allowlist. Safe for anyone
 *   with Journal access.
 * - `sql`: `whereSql` holds a bare boolean expression spliced into the WHERE.
 *   **Administrators only**, and checked by `assertReadOnlyFragment` on save and
 *   again on run.
 */
export type ReportWhereMode = "filter" | "sql";

export const REPORT_WHERE_MODES: readonly ReportWhereMode[] = ["filter", "sql"];

/**
 * Which piece of the HTML template a detail row holds.
 *
 * `header` and `footer` render once; `row` renders once per matching entry. An
 * aggregate report (a monthly rollup, a word ranking) has no `row` part at all —
 * that is a legitimate state, not a half-built report.
 */
export type ReportPartKind = "header" | "row" | "footer";

export const REPORT_PART_KINDS: readonly ReportPartKind[] = ["header", "row", "footer"];

/** The field an entry list is ordered by. Indexes an allowlist before it reaches SQL. */
export type ReportSortField = "date" | "time" | "title" | "placeName" | "createdAt";

export const REPORT_SORT_FIELDS: readonly ReportSortField[] = [
  "date",
  "time",
  "title",
  "placeName",
  "createdAt",
];

export type ReportSortDirection = "asc" | "desc";

/** One piece of a report's HTML template. */
export interface JournalReportDetail {
  id: number;
  reportId: number;
  part: ReportPartKind;
  html: string;
  sortOrder: number;
}

/**
 * A report's header: what it is called and which entries feed it.
 *
 * Both `whereQuery` and `whereSql` are carried regardless of `whereMode`, so
 * switching modes in the editor doesn't discard the other mode's text. Only the
 * one named by `whereMode` is ever executed.
 */
export interface JournalReport {
  id: number;
  name: string;
  description: string;
  whereMode: ReportWhereMode;
  whereQuery: string;
  whereSql: string;
  sortField: ReportSortField;
  sortDirection: ReportSortDirection;
  /** 0 = no limit. */
  maxRows: number;
  /** Seeded by migration 0132. Editable, but refused by `deleteReport`. */
  isBuiltin: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** A report plus its template parts — what the editor and the runner both need. */
export interface JournalReportWithDetails {
  report: JournalReport;
  details: JournalReportDetail[];
}

/** A list row: the header fields plus enough to describe it without loading the template. */
export interface JournalReportSummary {
  id: number;
  name: string;
  description: string;
  whereMode: ReportWhereMode;
  /** The query or the SQL, whichever `whereMode` names. For display only. */
  whereText: string;
  isBuiltin: boolean;
  sortOrder: number;
  updatedAt: string;
}

/**
 * What a rendered report comes back as.
 *
 * `html` is ready to inject; `entryCount` is what the runner actually matched,
 * which the view shows so an empty report reads as "nothing matched" rather than
 * a broken template.
 */
export interface RenderedReport {
  html: string;
  entryCount: number;
}
