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

export function buildDropTableSql(tableName: string): string {
  return `DROP TABLE IF EXISTS ${quoteIdentifier(tableName)}`;
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
