// Turns a report's entry selection into a SQL fragment and its parameters.
//
// This is the one place either mode becomes SQL, which is what lets the
// encrypted-entry exclusion be appended once, by the runner, rather than
// depending on every report author remembering it. An encrypted entry has
// title = '' and content = '' (migration 0131), so including one prints a blank
// row — the failure looks like a broken template rather than a wrong filter,
// which is why it is not left to the author.

import { buildFilterSql, parseFilterQuery } from "@/lib/journal";
import { assertReadOnlyFragment } from "./sql-guard";
import type { JournalReport, ReportSortDirection, ReportSortField } from "./types";
import { REPORT_SORT_FIELDS } from "./types";

export interface CompiledWhere {
  /** Everything after `WHERE`, always non-empty — the exclusion alone guarantees it. */
  sql: string;
  params: Record<string, string | number>;
}

/**
 * Encrypted entries are never in a report. Appended to both modes.
 *
 * Written against the `e` alias because every query this feeds aliases
 * `jrn_entries` as `e` — the same alias `buildFilterSql`'s FIELD_COLUMNS use.
 */
const EXCLUDE_ENCRYPTED = "e.is_encrypted = 0";

/**
 * Compiles a report's selection.
 *
 * Throws `FilterQueryError` (filter mode) or `ReportSqlError` (sql mode) with a
 * message meant for the author. Deliberately does NOT fall back to "no
 * condition" on a bad query: a filter that quietly matches everything looks
 * exactly like one that worked, and on a report that means printing the whole
 * journal when you asked for one month.
 */
export function compileReportWhere(report: JournalReport): CompiledWhere {
  if (report.whereMode === "sql") {
    const fragment = report.whereSql.trim();
    // Re-checked here, not just on save. The table is a file on a NAS; it is not
    // the trust boundary.
    assertReadOnlyFragment(fragment);
    if (fragment === "") return { sql: EXCLUDE_ENCRYPTED, params: {} };
    // Parenthesised so an OR inside the fragment can't escape the AND and pull
    // encrypted entries back in: `a OR b AND excluded` would bind as
    // `a OR (b AND excluded)`.
    return { sql: `(${fragment}) AND ${EXCLUDE_ENCRYPTED}`, params: {} };
  }

  const query = report.whereQuery.trim();
  if (query === "") return { sql: EXCLUDE_ENCRYPTED, params: {} };

  // Throws FilterQueryError on a malformed query, which the caller renders.
  const filter = parseFilterQuery(query);
  const compiled = buildFilterSql(filter);
  // `undefined` means the parsed filter narrows nothing — a query of all-blank
  // conditions. Treated as "every entry", matching findEntries.
  if (!compiled) return { sql: EXCLUDE_ENCRYPTED, params: {} };

  return {
    sql: `(${compiled.sql}) AND ${EXCLUDE_ENCRYPTED}`,
    params: compiled.params,
  };
}

/** Field -> the column it sorts on. Literals only; never anything derived from input. */
const SORT_COLUMNS: Record<ReportSortField, string> = {
  date: "e.entry_date",
  time: "e.entry_time",
  title: "e.title",
  placeName: "e.place_name",
  createdAt: "e.created_at",
};

/**
 * The ORDER BY for a report, as a literal string.
 *
 * Both halves index an allowlist rather than being interpolated: an unknown
 * field falls back to date, and the direction is one of two literals. So a
 * tampered `sort_field` column can't inject anything.
 *
 * Ties break on `e.id` so a report with several entries on one date has a stable
 * order between runs — without it, two prints of the same report can disagree.
 */
export function reportOrderBy(field: ReportSortField, direction: ReportSortDirection): string {
  const column = SORT_COLUMNS[field] ?? SORT_COLUMNS.date;
  const dir = direction === "asc" ? "ASC" : "DESC";
  return `${column} ${dir}, e.id ${dir}`;
}

export function isReportSortField(value: string): value is ReportSortField {
  return (REPORT_SORT_FIELDS as readonly string[]).includes(value);
}
