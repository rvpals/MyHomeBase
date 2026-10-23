// The Entries browser's query, in one place.
//
// This exists so the SQL the grid *shows* and the SQL the repository *runs*
// cannot drift. `JournalSqliteRepository.findEntries` used to assemble the
// statement inline; it now calls `buildEntriesSql` and prepares what comes
// back, and the "Show SQL" dialog renders the same string with its parameters
// inlined. A change to the WHERE assembly therefore lands in both at once —
// the alternative, a hand-written "equivalent query" beside the real one (what
// the Journal home screen does), is honest only until someone edits one of the
// two.

import { buildBodyLengthSql, type JournalBodyScope } from "./body-length";
import { buildFilterSql, buildOrderBy } from "./filters";
import type { JournalFilter } from "./types";

/** A statement and the named parameters it expects. */
export interface EntriesSql {
  sql: string;
  params: Record<string, string | number>;
}

/** The parameter name carrying the row cap. Prefixed so a filter can't collide. */
const LIMIT_PARAM = "__limit";

/**
 * The exact statement the Entries browser runs for `filter`.
 *
 * The three narrowings arrive by different routes and are deliberately kept
 * apart: the reader's saved filter compiles to `compiled.sql`, the lock scope
 * has already been folded into `filter` by `withLockedCondition`, and the body
 * scope rides alongside as its own term because the filter schema would drop
 * it (see body-length.ts).
 */
export function buildEntriesSql(
  filter: JournalFilter,
  limit: number,
  bodyScope: JournalBodyScope = "all",
): EntriesSql {
  const compiled = buildFilterSql(filter);
  const body = buildBodyLengthSql(bodyScope);

  // No WHERE at all when nothing narrows, rather than a synthetic `1=1` — an
  // empty filter is a real state ("All entries") and this keeps the query the
  // planner sees identical to listRecentEntries in that case.
  const terms: string[] = [];
  // Parenthesised: the filter's own groups may be joined with OR, and ANDing
  // the body-length term onto a bare `a OR b` would bind to `b` alone.
  if (compiled) terms.push(`(${compiled.sql})`);
  if (body) terms.push(body.sql);
  const where = terms.length > 0 ? `WHERE ${terms.join(" AND ")}` : "";

  // Literal string from an allowlist, never interpolated input — see
  // buildOrderBy. An empty sort yields the same clause this query always had.
  const orderBy = buildOrderBy(filter.sort);

  // Laid out over several lines because this string is now read by a person in
  // the "Show SQL" dialog, not only by SQLite. The blank-WHERE case would leave
  // a dangling empty line, so the clauses are joined rather than templated.
  const lines = ["SELECT e.*", "FROM jrn_entries e"];
  if (where) lines.push(where);
  lines.push(`ORDER BY ${orderBy}`, `LIMIT @${LIMIT_PARAM}`);

  return {
    sql: lines.join("\n"),
    params: {
      ...(compiled?.params ?? {}),
      ...(body?.params ?? {}),
      [LIMIT_PARAM]: limit,
    },
  };
}

/**
 * The same statement with its named parameters substituted in, for display.
 *
 * **Display only — never prepare this.** Inlining defeats the point of bound
 * parameters; the repository always runs `buildEntriesSql` with its params
 * bound. This exists because `@p0_1` tells a reader nothing about which
 * category they filtered on.
 *
 * Longest name first, so `@__limit` is never partly eaten by a shorter `@__li`
 * sharing its prefix. Values are quoted the way SQLite expects: a string's
 * embedded `'` is doubled, and a number is written bare.
 */
export function inlineSqlParams(
  sql: string,
  params: Record<string, string | number>,
): string {
  return Object.keys(params)
    .sort((a, b) => b.length - a.length)
    .reduce((text, name) => text.split(`@${name}`).join(formatSqlValue(params[name])), sql);
}

/** One parameter as a SQL literal. */
function formatSqlValue(value: string | number): string {
  if (typeof value === "number") return String(value);
  return `'${value.split("'").join("''")}'`;
}

/** The Entries query with its parameters inlined — what "Show SQL" opens with. */
export function describeEntriesSql(
  filter: JournalFilter,
  limit: number,
  bodyScope: JournalBodyScope = "all",
): string {
  const { sql, params } = buildEntriesSql(filter, limit, bodyScope);
  return inlineSqlParams(sql, params);
}
