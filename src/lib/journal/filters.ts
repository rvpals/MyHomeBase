// Pure — no I/O, no SQL execution. Everything about a saved journal filter that
// isn't storage: what a filter *is*, how it reads in English, and how it compiles
// to a parameterized WHERE clause.
//
// This file is the security boundary for the Entries browser. A filter arrives as
// JSON from a database column, which means its `field` and `operator` strings are
// untrusted input. Two rules hold throughout and must not be relaxed:
//
//   1. A field name is never used as a SQL identifier. It indexes a fixed
//      allowlist (FIELD_COLUMNS) whose values are literals written here.
//   2. A user value is never interpolated into SQL text. Every value leaves as a
//      named parameter.
//
// Consequence: an unknown field or operator can't reach the query. It's rejected
// by the zod schema on the way in, and `compileCondition` still returns undefined
// rather than guessing, so a filter that somehow carries one degrades to "that
// condition doesn't apply" instead of failing open (matching everything) or
// throwing.

import type {
  JournalFilter,
  JournalFilterCondition,
  JournalFilterField,
  JournalFilterGroup,
  JournalFilterOperator,
} from "./types";

/**
 * Field -> the column (or child-table shape) it filters on.
 *
 * Values here are literals, never anything derived from input. `kind` decides how
 * the condition compiles: a plain column comparison, a child-table EXISTS, or a
 * 0/1 integer flag.
 */
const FIELD_COLUMNS: Record<
  JournalFilterField,
  | { kind: "text"; column: string }
  | { kind: "date"; column: string }
  | { kind: "boolean"; column: string }
  | { kind: "taxonomy"; table: string; nameColumn: string }
> = {
  date: { kind: "date", column: "e.entry_date" },
  time: { kind: "date", column: "e.entry_time" },
  title: { kind: "text", column: "e.title" },
  content: { kind: "text", column: "e.content" },
  placeName: { kind: "text", column: "e.place_name" },
  category: { kind: "taxonomy", table: "jrn_entry_categories", nameColumn: "category_name" },
  tag: { kind: "taxonomy", table: "jrn_entry_tags", nameColumn: "tag_name" },
  isPinned: { kind: "boolean", column: "e.is_pinned" },
  isLocked: { kind: "boolean", column: "e.is_locked" },
};

/** Which operators each field kind accepts. The UI reads this to build its dropdowns. */
export const OPERATORS_BY_FIELD: Record<JournalFilterField, JournalFilterOperator[]> = {
  date: ["equals", "before", "after", "between"],
  time: ["equals", "before", "after", "between"],
  title: ["contains", "notContains", "equals", "isEmpty", "isNotEmpty"],
  content: ["contains", "notContains", "equals", "isEmpty", "isNotEmpty"],
  placeName: ["contains", "notContains", "equals", "isEmpty", "isNotEmpty"],
  // Multi-valued: an entry carries a *list* of categories/tags, so "has any of"
  // and "has none of" are different EXISTS shapes, not one operator negated.
  category: ["hasAny", "hasNone"],
  tag: ["hasAny", "hasNone"],
  isPinned: ["is"],
  isLocked: ["is"],
};

/** Human labels for the builder's dropdowns and for describeFilter(). */
export const FIELD_LABELS: Record<JournalFilterField, string> = {
  date: "Date",
  time: "Time",
  title: "Title",
  content: "Content",
  placeName: "Place",
  category: "Category",
  tag: "Tag",
  isPinned: "Pinned",
  isLocked: "Locked",
};

const OPERATOR_LABELS: Record<JournalFilterOperator, string> = {
  contains: "contains",
  notContains: "does not contain",
  equals: "is",
  before: "is before",
  after: "is after",
  between: "is between",
  hasAny: "is any of",
  hasNone: "is none of",
  is: "is",
  isEmpty: "is empty",
  isNotEmpty: "is not empty",
};

/** Operators that ignore `value` entirely. */
const VALUELESS_OPERATORS: ReadonlySet<JournalFilterOperator> = new Set(["isEmpty", "isNotEmpty"]);

/** An operator taking two bounds rather than one value. */
const RANGE_OPERATORS: ReadonlySet<JournalFilterOperator> = new Set(["between"]);

/** Operators whose value is a list of names. */
const LIST_OPERATORS: ReadonlySet<JournalFilterOperator> = new Set(["hasAny", "hasNone"]);

export function isRangeOperator(operator: JournalFilterOperator): boolean {
  return RANGE_OPERATORS.has(operator);
}

export function isValuelessOperator(operator: JournalFilterOperator): boolean {
  return VALUELESS_OPERATORS.has(operator);
}

export function isListOperator(operator: JournalFilterOperator): boolean {
  return LIST_OPERATORS.has(operator);
}

/** An empty filter, for a builder opening on "new". */
export function emptyFilter(): JournalFilter {
  return { join: "AND", groups: [{ join: "AND", conditions: [] }] };
}

/**
 * Escapes the LIKE wildcards a user can type so they match literally, matching
 * what searchEntries already does. Without this, a title containing `%` would
 * silently match everything.
 */
function escapeLikeWildcards(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** Values a compiled condition contributes, keyed by its generated param name. */
export interface CompiledSql {
  sql: string;
  params: Record<string, string | number>;
}

/**
 * Compiles one condition. Returns undefined when the condition can't apply — an
 * unknown field/operator, or a blank value for an operator that needs one.
 *
 * Undefined means "contributes nothing", and the caller *drops* it rather than
 * treating it as true or false. A half-built condition in the UI (field chosen,
 * value still empty) therefore doesn't narrow the result to nothing while the
 * user is still typing — the same courtesy `parseFilterExpression` extends in the
 * DataGrid.
 */
function compileCondition(
  condition: JournalFilterCondition,
  paramPrefix: string,
): CompiledSql | undefined {
  const spec = FIELD_COLUMNS[condition.field];
  if (!spec) return undefined;

  const allowed = OPERATORS_BY_FIELD[condition.field];
  if (!allowed || !allowed.includes(condition.operator)) return undefined;

  const { operator } = condition;

  if (spec.kind === "taxonomy") {
    const names = (condition.values ?? []).map((name) => name.trim()).filter((name) => name !== "");
    if (names.length === 0) return undefined;

    const params: Record<string, string> = {};
    const placeholders = names.map((name, index) => {
      const key = `${paramPrefix}_${index}`;
      params[key] = name;
      return `@${key}`;
    });

    // A correlated EXISTS rather than a JOIN: an entry with three matching tags
    // must appear once, and a JOIN would duplicate the row per match.
    const exists = `EXISTS (SELECT 1 FROM ${spec.table} x WHERE x.entry_id = e.id AND x.${spec.nameColumn} IN (${placeholders.join(", ")}))`;
    return { sql: operator === "hasNone" ? `NOT ${exists}` : exists, params };
  }

  if (spec.kind === "boolean") {
    // Only `is` reaches here, and the stored value is 0/1.
    const key = paramPrefix;
    return { sql: `${spec.column} = @${key}`, params: { [key]: condition.value === "true" ? 1 : 0 } };
  }

  if (VALUELESS_OPERATORS.has(operator)) {
    // Columns are NOT NULL DEFAULT '' in this schema, so "empty" is the empty
    // string. Checking NULL too costs nothing and survives a hand-edited row.
    return operator === "isEmpty"
      ? { sql: `(${spec.column} IS NULL OR ${spec.column} = '')`, params: {} }
      : { sql: `(${spec.column} IS NOT NULL AND ${spec.column} <> '')`, params: {} };
  }

  if (RANGE_OPERATORS.has(operator)) {
    const from = (condition.value ?? "").trim();
    const to = (condition.valueTo ?? "").trim();
    // A half-filled range still narrows in the direction it can.
    if (from === "" && to === "") return undefined;
    const fromKey = `${paramPrefix}_from`;
    const toKey = `${paramPrefix}_to`;
    if (from !== "" && to !== "") {
      return {
        sql: `(${spec.column} >= @${fromKey} AND ${spec.column} <= @${toKey})`,
        params: { [fromKey]: from, [toKey]: to },
      };
    }
    return from !== ""
      ? { sql: `${spec.column} >= @${fromKey}`, params: { [fromKey]: from } }
      : { sql: `${spec.column} <= @${toKey}`, params: { [toKey]: to } };
  }

  const raw = (condition.value ?? "").trim();
  if (raw === "") return undefined;
  const key = paramPrefix;

  switch (operator) {
    case "contains":
      return {
        sql: `${spec.column} LIKE @${key} ESCAPE '\\'`,
        params: { [key]: `%${escapeLikeWildcards(raw)}%` },
      };
    case "notContains":
      return {
        sql: `${spec.column} NOT LIKE @${key} ESCAPE '\\'`,
        params: { [key]: `%${escapeLikeWildcards(raw)}%` },
      };
    case "equals":
      // Dates and times compare lexicographically, which is also chronological
      // for YYYY-MM-DD and HH:MM — so `equals` needs no date awareness.
      return { sql: `${spec.column} = @${key}`, params: { [key]: raw } };
    case "before":
      return { sql: `${spec.column} < @${key}`, params: { [key]: raw } };
    case "after":
      return { sql: `${spec.column} > @${key}`, params: { [key]: raw } };
    default:
      return undefined;
  }
}

function compileGroup(group: JournalFilterGroup, groupIndex: number): CompiledSql | undefined {
  const compiled: CompiledSql[] = [];
  group.conditions.forEach((condition, conditionIndex) => {
    const result = compileCondition(condition, `g${groupIndex}c${conditionIndex}`);
    if (result) compiled.push(result);
  });
  if (compiled.length === 0) return undefined;

  const join = group.join === "OR" ? " OR " : " AND ";
  const params = Object.assign({}, ...compiled.map((item) => item.params)) as Record<
    string,
    string | number
  >;
  const sql = compiled.map((item) => item.sql).join(join);
  return { sql: compiled.length > 1 ? `(${sql})` : sql, params };
}

/**
 * Compiles a whole filter into a WHERE fragment plus its named parameters.
 *
 * Returns `undefined` when nothing in the filter can apply (no groups, or every
 * condition incomplete). The caller must treat that as "no WHERE at all" — an
 * empty filter lists every entry, which is what the dropdown's "All entries"
 * does. Returning `"1=1"` would work too but hides the distinction from the
 * caller, and a filter that silently matches everything is worth being explicit
 * about.
 */
export function buildFilterSql(filter: JournalFilter): CompiledSql | undefined {
  const compiled: CompiledSql[] = [];
  filter.groups.forEach((group, groupIndex) => {
    const result = compileGroup(group, groupIndex);
    if (result) compiled.push(result);
  });
  if (compiled.length === 0) return undefined;

  const join = filter.join === "OR" ? " OR " : " AND ";
  const params = Object.assign({}, ...compiled.map((item) => item.params)) as Record<
    string,
    string | number
  >;
  return { sql: compiled.map((item) => item.sql).join(join), params };
}

/** One condition in English, e.g. `Category is any of Travel, Work`. */
export function describeCondition(condition: JournalFilterCondition): string {
  const field = FIELD_LABELS[condition.field] ?? condition.field;
  const operator = OPERATOR_LABELS[condition.operator] ?? condition.operator;

  if (VALUELESS_OPERATORS.has(condition.operator)) return `${field} ${operator}`;

  if (LIST_OPERATORS.has(condition.operator)) {
    const names = (condition.values ?? []).filter((name) => name.trim() !== "");
    return names.length === 0 ? `${field} ${operator} …` : `${field} ${operator} ${names.join(", ")}`;
  }

  if (RANGE_OPERATORS.has(condition.operator)) {
    const from = (condition.value ?? "").trim();
    const to = (condition.valueTo ?? "").trim();
    if (from !== "" && to !== "") return `${field} ${operator} ${from} and ${to}`;
    if (from !== "") return `${field} is after ${from}`;
    if (to !== "") return `${field} is before ${to}`;
    return `${field} ${operator} …`;
  }

  if (condition.field === "isPinned" || condition.field === "isLocked") {
    return `${field} ${operator} ${condition.value === "true" ? "yes" : "no"}`;
  }

  const value = (condition.value ?? "").trim();
  return value === "" ? `${field} ${operator} …` : `${field} ${operator} "${value}"`;
}

/**
 * The whole filter in English, for the "Filter conditions" card — e.g.
 * `Category is any of Travel AND (Title contains trip OR Place contains Rome)`.
 *
 * Incomplete conditions are rendered with a `…` placeholder rather than dropped,
 * because this text explains a *saved* filter: silently omitting a condition the
 * user can see in the builder would be worse than showing it as unfinished.
 */
export function describeFilter(filter: JournalFilter): string {
  const groups = filter.groups
    .map((group) => {
      const parts = group.conditions.map(describeCondition);
      if (parts.length === 0) return "";
      const joined = parts.join(group.join === "OR" ? " OR " : " AND ");
      return parts.length > 1 ? `(${joined})` : joined;
    })
    .filter((text) => text !== "");

  if (groups.length === 0) return "No conditions — matches every entry.";
  return groups.join(filter.join === "OR" ? " OR " : " AND ");
}

/** True when nothing in the filter would narrow the results. */
export function isFilterEmpty(filter: JournalFilter): boolean {
  return buildFilterSql(filter) === undefined;
}
