// Pure — no I/O, no better-sqlite3 import. This is the injection-risk surface for the
// whole domain: user-supplied CSV headers and a user-typed table name become real SQL
// identifiers here. Every identifier is restricted to [a-z0-9_] before it ever reaches a
// SQL string, and every identifier is still double-quoted (defense in depth).
import type { CsvColumnDefinition, CsvColumnType } from "./types";

const MAX_IDENTIFIER_LENGTH = 40;

/** Lowercases, collapses anything not [a-z0-9] into a single "_", trims edges, caps length. */
export function slugifyIdentifier(raw: string, emptyFallback = "col"): string {
  let slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_IDENTIFIER_LENGTH);

  if (slug === "") slug = emptyFallback;
  if (/^[0-9]/.test(slug)) slug = `c_${slug}`.slice(0, MAX_IDENTIFIER_LENGTH);
  return slug;
}

/** Slugifies every name, then appends _2, _3... to any repeat so the result is unique. */
export function dedupeColumnNames(names: string[]): string[] {
  const seenCounts = new Map<string, number>();
  return names.map((raw) => {
    const base = slugifyIdentifier(raw);
    const count = seenCounts.get(base) ?? 0;
    seenCounts.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
}

/** The physical table always carries the csv_ prefix — the field IS the base name. */
export function buildTableName(baseName: string): string {
  return `csv_${slugifyIdentifier(baseName, "table")}`;
}

/** Wraps an identifier in double quotes, doubling any embedded quote. */
export function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

const SQLITE_TYPE_BY_COLUMN_TYPE: Record<CsvColumnType, string> = {
  text: "TEXT",
  integer: "INTEGER",
  real: "REAL",
  boolean: "INTEGER",
  date: "TEXT",
  datetime: "TEXT",
};

/**
 * Builds the CREATE TABLE statement for an entry's physical table. With no primary key
 * fields, adds a surrogate autoincrement key instead of a composite key on user columns.
 */
export function buildCreateTableSql(
  tableName: string,
  columns: CsvColumnDefinition[],
  primaryKeyFields: string[],
): string {
  const columnLines = columns.map(
    (column) => `  ${quoteIdentifier(column.name)} ${SQLITE_TYPE_BY_COLUMN_TYPE[column.type]}`,
  );

  if (primaryKeyFields.length === 0) {
    columnLines.unshift(`  ${quoteIdentifier("_row_id")} INTEGER PRIMARY KEY AUTOINCREMENT`);
  } else {
    columnLines.push(`  PRIMARY KEY (${primaryKeyFields.map(quoteIdentifier).join(", ")})`);
  }

  return `CREATE TABLE ${quoteIdentifier(tableName)} (\n${columnLines.join(",\n")}\n)`;
}

/**
 * The alias the rowid is read back under. Not a column name a CSV can produce —
 * `slugifyIdentifier` strips the leading underscore off any header, so no declared
 * column can ever collide with it.
 */
export const ROWID_ALIAS = "_rowid";

/**
 * Builds the SELECT that `readTableData` uses: the declared columns in definition
 * order, plus `rowid` last under `ROWID_ALIAS`.
 *
 * The rowid goes LAST so the value arrays returned by a `.raw()` read still line up
 * 1:1 with `columns` by index — the caller slices it off the end.
 */
export function buildSelectRowsSql(
  tableName: string,
  columns: CsvColumnDefinition[],
  limit?: number,
): string {
  const columnList = columns.map((column) => quoteIdentifier(column.name)).join(", ");
  const limitClause = limit !== undefined && limit > 0 ? ` LIMIT ${Math.floor(limit)}` : "";
  return `SELECT ${columnList}, rowid AS ${quoteIdentifier(ROWID_ALIAS)} FROM ${quoteIdentifier(tableName)}${limitClause}`;
}

/**
 * Builds the UPDATE for a bulk edit: one value per named field, applied to every
 * rowid in the selection.
 *
 * Same two rules as everything else in this file. `fields` are column *names*, so
 * they are identifiers — the caller has already validated each one against the
 * entry's real column list (`bulkEditRows` does), and they are still quoted here.
 * Every value is a bound parameter: `@<name>` per field, then positional `?`s for
 * the rowids, in that order.
 *
 * `rowIdCount` builds the `IN (?, ?, …)` list. Zero rowids would make an UPDATE that
 * matches nothing but reads as valid SQL, so it throws instead — a bulk edit with an
 * empty selection is a caller bug, not a no-op worth executing.
 */
export function buildBulkUpdateSql(
  tableName: string,
  fields: string[],
  rowIdCount: number,
): string {
  if (fields.length === 0) throw new Error("A bulk update needs at least one field to set.");
  if (rowIdCount <= 0) throw new Error("A bulk update needs at least one row id.");

  const assignments = fields
    .map((field) => `${quoteIdentifier(field)} = @${field}`)
    .join(", ");
  const placeholders = new Array(Math.floor(rowIdCount)).fill("?").join(", ");
  return `UPDATE ${quoteIdentifier(tableName)} SET ${assignments} WHERE rowid IN (${placeholders})`;
}

export function buildDropTableSql(tableName: string): string {
  return `DROP TABLE IF EXISTS ${quoteIdentifier(tableName)}`;
}

/** Builds one ALTER TABLE ... ADD COLUMN statement. Existing rows get NULL for the new column. */
export function buildAddColumnSql(tableName: string, column: CsvColumnDefinition): string {
  return `ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier(column.name)} ${SQLITE_TYPE_BY_COLUMN_TYPE[column.type]}`;
}

/** Named-parameter INSERT — param keys match column.name exactly, for better-sqlite3's object binding. */
export function buildInsertSql(
  tableName: string,
  columns: CsvColumnDefinition[],
  orIgnore: boolean,
): string {
  const columnList = columns.map((column) => quoteIdentifier(column.name)).join(", ");
  const paramList = columns.map((column) => `@${column.name}`).join(", ");
  return `INSERT ${orIgnore ? "OR IGNORE " : ""}INTO ${quoteIdentifier(tableName)} (${columnList}) VALUES (${paramList})`;
}

/** Best-effort per-cell coercion. Never throws — an empty or unparseable cell becomes NULL. */
export function coerceCellValue(raw: string | undefined, type: CsvColumnType): string | number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  switch (type) {
    case "text":
      return trimmed;
    case "integer": {
      const value = Number(trimmed);
      return Number.isFinite(value) && Number.isInteger(value) ? value : null;
    }
    case "real": {
      const value = Number(trimmed);
      return Number.isFinite(value) ? value : null;
    }
    case "boolean": {
      const lower = trimmed.toLowerCase();
      if (["true", "1", "yes", "y"].includes(lower)) return 1;
      if (["false", "0", "no", "n"].includes(lower)) return 0;
      return null;
    }
    case "date": {
      const parsed = new Date(trimmed);
      return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
    }
    case "datetime": {
      const parsed = new Date(trimmed);
      return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }
  }
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Suggests a column type from a handful of sample values (typically the CSV preview
 * rows) — checked most-specific first so, e.g., a column of "0"/"1" is suggested as
 * integer rather than boolean. Falls back to "text" for an empty sample or anything
 * that doesn't cleanly fit another type.
 */
export function inferColumnType(sampleValues: string[]): CsvColumnType {
  const values = sampleValues.map((value) => value.trim()).filter((value) => value !== "");
  if (values.length === 0) return "text";

  if (values.every((value) => coerceCellValue(value, "integer") !== null)) return "integer";
  if (values.every((value) => coerceCellValue(value, "real") !== null)) return "real";
  if (values.every((value) => coerceCellValue(value, "boolean") !== null)) return "boolean";
  if (values.every((value) => DATE_ONLY_PATTERN.test(value))) return "date";
  if (values.every((value) => coerceCellValue(value, "datetime") !== null)) return "datetime";
  return "text";
}
