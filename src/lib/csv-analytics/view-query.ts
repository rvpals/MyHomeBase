// Compiles a saved custom view into a SELECT against one entry's physical table.
//
// Pure — no I/O, no better-sqlite3 import. This is an injection-risk surface on the
// same footing as sql-builder.ts, and it follows the same two rules:
//
//   - Identifiers (column names) are VALIDATED against the entry's real column list
//     before use, and are still double-quoted afterwards (defense in depth). An
//     unknown name is never interpolated.
//   - Literals are ALWAYS bound parameters. The only values that reach the SQL string
//     are LIMIT/OFFSET, which SQLite won't take as parameters here — both are coerced
//     through Math.floor on a validated positive integer first.
//
// Operators arrive as a closed union (types.ts), so no operator text is user-supplied.
import { coerceCellValue, quoteIdentifier } from "./sql-builder";
import type {
  CsvColumnDefinition,
  CsvViewCriterion,
  CsvViewOperator,
  CsvViewOperatorArity,
  CsvViewOrderBy,
} from "./types";

export const CSV_VIEW_OPERATORS: CsvViewOperator[] = [
  "equals",
  "notEquals",
  "greaterThan",
  "greaterThanOrEqual",
  "lessThan",
  "lessThanOrEqual",
  "contains",
  "notContains",
  "startsWith",
  "endsWith",
  "between",
  "isEmpty",
  "isNotEmpty",
  "in",
  "notIn",
];

/** How many values each operator needs. The builder UI reads this to show the right inputs. */
export const CSV_VIEW_OPERATOR_ARITY: Record<CsvViewOperator, CsvViewOperatorArity> = {
  equals: "one",
  notEquals: "one",
  greaterThan: "one",
  greaterThanOrEqual: "one",
  lessThan: "one",
  lessThanOrEqual: "one",
  contains: "one",
  notContains: "one",
  startsWith: "one",
  endsWith: "one",
  between: "two",
  isEmpty: "none",
  isNotEmpty: "none",
  in: "list",
  notIn: "list",
};

/** Short symbol/label per operator, for the dropdown and for reading a view back. */
export const CSV_VIEW_OPERATOR_LABELS: Record<CsvViewOperator, string> = {
  equals: "=",
  notEquals: "<>",
  greaterThan: ">",
  greaterThanOrEqual: ">=",
  lessThan: "<",
  lessThanOrEqual: "<=",
  contains: "contains",
  notContains: "does not contain",
  startsWith: "starts with",
  endsWith: "ends with",
  between: "between",
  isEmpty: "is empty",
  isNotEmpty: "is not empty",
  in: "is one of",
  notIn: "is not one of",
};

export function operatorArity(operator: CsvViewOperator): CsvViewOperatorArity {
  return CSV_VIEW_OPERATOR_ARITY[operator];
}

/** The comparison operators that map 1:1 onto a SQL infix operator. */
const COMPARISON_SQL: Partial<Record<CsvViewOperator, string>> = {
  equals: "=",
  notEquals: "<>",
  greaterThan: ">",
  greaterThanOrEqual: ">=",
  lessThan: "<",
  lessThanOrEqual: "<=",
};

/** The ESCAPE character used with every LIKE, as it appears inside the SQL string. */
const LIKE_ESCAPE_CLAUSE = "ESCAPE '\\'";

/**
 * Escapes the LIKE wildcards in a user's literal so "50%" matches a literal percent
 * sign rather than "50 followed by anything". Paired with LIKE_ESCAPE_CLAUSE.
 */
function escapeLikeLiteral(raw: string): string {
  return raw.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export interface CompiledViewQuery {
  /** The page query: SELECT <columns> FROM <table> [WHERE] [ORDER BY] LIMIT n OFFSET n. */
  sql: string;
  /** SELECT COUNT(*) over the same WHERE — the total the pager needs. */
  countSql: string;
  /** Bound parameters, positional, in the order both statements consume them. */
  params: (string | number | null)[];
  /** The column definitions the returned rows line up with, 1:1 and in order. */
  columns: CsvColumnDefinition[];
}

export interface CompileViewQueryInput {
  tableName: string;
  /** The entry's full column list — the allowlist every identifier is checked against. */
  entryColumns: CsvColumnDefinition[];
  /** Empty means every column (see migration 0081). */
  selectedColumns: string[];
  criteria: CsvViewCriterion[];
  orderBy: CsvViewOrderBy[];
  recordsPerPage: number;
  /** 1-based. */
  page: number;
}

/**
 * Resolves the view's selected columns against the entry's current schema.
 *
 * Empty selection means every column. A named column that no longer exists is
 * skipped rather than throwing: an entry can lose a column to an Overwrite ingest,
 * and a view that names it should degrade to the columns that remain instead of
 * becoming unopenable. If nothing survives, falls back to every column — a view
 * showing no columns at all is never the useful reading.
 */
export function resolveSelectedColumns(
  entryColumns: CsvColumnDefinition[],
  selectedColumns: string[],
): CsvColumnDefinition[] {
  if (selectedColumns.length === 0) return entryColumns;
  const resolved = selectedColumns
    .map((name) => entryColumns.find((column) => column.name === name))
    .filter((column): column is CsvColumnDefinition => column !== undefined);
  return resolved.length > 0 ? resolved : entryColumns;
}

/**
 * Coerces a criterion's raw text to the column's type so a numeric column compares
 * numerically. An unparseable value for a typed column falls back to the raw text,
 * which simply matches nothing rather than erroring — a half-typed criterion should
 * empty the result, not break the screen.
 */
function bindValue(raw: string, column: CsvColumnDefinition): string | number | null {
  if (column.type === "text") return raw;
  const coerced = coerceCellValue(raw, column.type);
  return coerced === null ? raw : coerced;
}

/** Builds one criterion's SQL fragment, pushing its literals onto `params`. */
function compileCriterion(
  criterion: CsvViewCriterion,
  column: CsvColumnDefinition,
  params: (string | number | null)[],
): string | undefined {
  const quoted = quoteIdentifier(column.name);
  const values = criterion.values.map((value) => value.trim()).filter((value) => value !== "");

  const comparison = COMPARISON_SQL[criterion.operator];
  if (comparison) {
    if (values.length < 1) return undefined;
    params.push(bindValue(values[0], column));
    return `${quoted} ${comparison} ?`;
  }

  switch (criterion.operator) {
    case "contains":
    case "notContains": {
      if (values.length < 1) return undefined;
      params.push(`%${escapeLikeLiteral(values[0])}%`);
      // A NULL never satisfies NOT LIKE, so "does not contain" would otherwise
      // silently drop every empty cell. An empty cell genuinely does not contain.
      return criterion.operator === "notContains"
        ? `(${quoted} IS NULL OR ${quoted} NOT LIKE ? ${LIKE_ESCAPE_CLAUSE})`
        : `${quoted} LIKE ? ${LIKE_ESCAPE_CLAUSE}`;
    }
    case "startsWith": {
      if (values.length < 1) return undefined;
      params.push(`${escapeLikeLiteral(values[0])}%`);
      return `${quoted} LIKE ? ${LIKE_ESCAPE_CLAUSE}`;
    }
    case "endsWith": {
      if (values.length < 1) return undefined;
      params.push(`%${escapeLikeLiteral(values[0])}`);
      return `${quoted} LIKE ? ${LIKE_ESCAPE_CLAUSE}`;
    }
    case "between": {
      // Both bounds are required — one bound alone is an unfinished criterion, not
      // an open-ended range. The save path refuses it; a read skips it.
      if (values.length < 2) return undefined;
      params.push(bindValue(values[0], column), bindValue(values[1], column));
      return `${quoted} BETWEEN ? AND ?`;
    }
    case "isEmpty":
      // "Empty" covers both NULL and the empty string: coerceCellValue writes NULL
      // for a blank cell on import, but a text column can hold a real "" as well.
      return `(${quoted} IS NULL OR ${quoted} = '')`;
    case "isNotEmpty":
      return `(${quoted} IS NOT NULL AND ${quoted} <> '')`;
    case "in":
    case "notIn": {
      if (values.length === 0) return undefined;
      values.forEach((value) => params.push(bindValue(value, column)));
      const placeholders = values.map(() => "?").join(", ");
      return criterion.operator === "notIn"
        ? `(${quoted} IS NULL OR ${quoted} NOT IN (${placeholders}))`
        : `${quoted} IN (${placeholders})`;
    }
  }
}

/**
 * Compiles the view into a page query and its matching COUNT.
 *
 * A criterion naming a column the entry doesn't have is skipped, as is one whose
 * values don't fill its operator's arity — same reasoning as a dropped selected
 * column: a view outliving a schema change degrades rather than breaking. Callers
 * that want to *report* those (the save path) validate first, via
 * `findUnknownColumns` and `findIncompleteCriteria`.
 */
export function compileViewQuery(input: CompileViewQueryInput): CompiledViewQuery {
  const columns = resolveSelectedColumns(input.entryColumns, input.selectedColumns);
  const params: (string | number | null)[] = [];

  const whereFragments = input.criteria
    .map((criterion) => {
      const column = input.entryColumns.find((candidate) => candidate.name === criterion.column);
      return column ? compileCriterion(criterion, column, params) : undefined;
    })
    .filter((fragment): fragment is string => fragment !== undefined);

  const whereClause = whereFragments.length > 0 ? ` WHERE ${whereFragments.join(" AND ")}` : "";

  const orderFragments = input.orderBy
    .filter((order) => input.entryColumns.some((column) => column.name === order.column))
    .map((order) => `${quoteIdentifier(order.column)} ${order.direction === "desc" ? "DESC" : "ASC"}`);
  const orderClause = orderFragments.length > 0 ? ` ORDER BY ${orderFragments.join(", ")}` : "";

  const table = quoteIdentifier(input.tableName);
  const columnList = columns.map((column) => quoteIdentifier(column.name)).join(", ");

  // LIMIT/OFFSET are the one place a number reaches the string rather than a bound
  // parameter. Both are floored non-negative integers, so neither can carry SQL.
  const recordsPerPage = Math.max(1, Math.floor(input.recordsPerPage));
  const page = Math.max(1, Math.floor(input.page));
  const offset = (page - 1) * recordsPerPage;

  return {
    sql: `SELECT ${columnList} FROM ${table}${whereClause}${orderClause} LIMIT ${recordsPerPage} OFFSET ${offset}`,
    countSql: `SELECT COUNT(*) AS count FROM ${table}${whereClause}`,
    params,
    columns,
  };
}

/**
 * Every column name in a view definition that the entry doesn't have. Used by the
 * save path to reject a bad definition at the boundary, where the user can still
 * fix it — as opposed to `compileViewQuery`, which forgives at read time.
 */
export function findUnknownColumns(
  entryColumns: CsvColumnDefinition[],
  definition: {
    selectedColumns: string[];
    criteria: CsvViewCriterion[];
    orderBy: CsvViewOrderBy[];
  },
): string[] {
  const known = new Set(entryColumns.map((column) => column.name));
  const referenced = [
    ...definition.selectedColumns,
    ...definition.criteria.map((criterion) => criterion.column),
    ...definition.orderBy.map((order) => order.column),
  ];
  return [...new Set(referenced.filter((name) => !known.has(name)))];
}

/**
 * The criteria whose values don't fill their operator's arity. A saved view with one
 * of these would quietly filter on less than the user typed, so the save path
 * refuses it rather than storing a criterion that does nothing.
 */
export function findIncompleteCriteria(criteria: CsvViewCriterion[]): CsvViewCriterion[] {
  return criteria.filter((criterion) => {
    const values = criterion.values.map((value) => value.trim()).filter((value) => value !== "");
    switch (operatorArity(criterion.operator)) {
      case "none":
        return false;
      case "one":
        return values.length < 1;
      case "two":
        return values.length < 2;
      case "list":
        return values.length === 0;
    }
  });
}

/** Renders a view's criteria as readable text, e.g. `amount >= 100 AND city is one of A, B`. */
export function describeCriteria(criteria: CsvViewCriterion[]): string {
  if (criteria.length === 0) return "No criteria";
  return criteria
    .map((criterion) => {
      const label = CSV_VIEW_OPERATOR_LABELS[criterion.operator];
      switch (operatorArity(criterion.operator)) {
        case "none":
          return `${criterion.column} ${label}`;
        case "two":
          return `${criterion.column} ${label} ${criterion.values[0] ?? ""} and ${criterion.values[1] ?? ""}`;
        default:
          return `${criterion.column} ${label} ${criterion.values.join(", ")}`;
      }
    })
    .join(" AND ");
}

/** Renders a view's order-by as readable text, e.g. `amount desc, city asc`. */
export function describeOrderBy(orderBy: CsvViewOrderBy[]): string {
  if (orderBy.length === 0) return "Unordered";
  return orderBy.map((order) => `${order.column} ${order.direction}`).join(", ");
}
