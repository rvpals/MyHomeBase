import type Database from "better-sqlite3";
import type { BlobCellSource } from "./blob-cells";
import type { SqlExplorerRepository } from "./ports";
import type { SchemaObject, SchemaObjectKind, SqlExecutionResult, TableInfo, TablePage } from "./types";

const READ_ONLY_STATEMENT_PATTERN = /^(SELECT|PRAGMA|EXPLAIN)/i;

interface TableInfoRow {
  name: string;
  type: string;
  pk: number;
  notnull: number;
}

// The real repository. This is a deliberately thin, dangerous-by-design admin
// tool — it runs whatever SQL an admin gives it against the app's live database.
export class SqliteSqlExplorerRepository implements SqlExplorerRepository {
  constructor(private db: Database.Database) {}

  listTables(): TableInfo[] {
    const tables = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[];

    return tables.map((table) => {
      const columns = this.db.prepare(`PRAGMA table_info('${table.name}')`).all() as TableInfoRow[];
      return {
        name: table.name,
        columns: columns.map((column) => ({
          name: column.name,
          type: column.type,
          isPrimaryKey: column.pk === 1,
          isNotNull: column.notnull === 1,
        })),
      };
    });
  }

  listSchemaObjects(): SchemaObject[] {
    // `tbl_name` is the object's own name for a table or view, and the owning
    // table for an index or trigger — so it is only meaningful for the latter.
    const rows = this.db
      .prepare(
        `SELECT name, type, tbl_name, sql
           FROM sqlite_master
          WHERE type IN ('table', 'view', 'index', 'trigger')
            AND name NOT LIKE 'sqlite_%'
          ORDER BY name`,
      )
      .all() as { name: string; type: string; tbl_name: string; sql: string | null }[];

    return rows.map((row) => ({
      name: row.name,
      kind: row.type as SchemaObjectKind,
      tableName: row.type === "index" || row.type === "trigger" ? row.tbl_name : "",
      sql: row.sql,
    }));
  }

  readTablePage(tableName: string, limit: number): TablePage {
    // Views return rows too, so the tree can open one — hence the readable
    // resolve rather than the table-only one truncate uses.
    const name = this.resolveReadableName(tableName);

    const total = this.db.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get() as {
      count: number;
    };
    // The rowid rides along under a reserved alias so a BLOB cell can be found
    // again when the reader asks to save it. It is requested separately from
    // `*` — `SELECT *` does not include it — and only where it exists: a view
    // or a WITHOUT ROWID table has none, and asking would throw.
    const rowIdAlias = "__mhb_rowid";
    const hasRowIds = this.hasRowIds(name);
    const selection = hasRowIds ? `rowid AS "${rowIdAlias}", *` : "*";
    const rows = this.db.prepare(`SELECT ${selection} FROM "${name}" LIMIT ?`).all(limit) as Record<
      string,
      unknown
    >[];

    // A table with no rows still has columns, and the grid needs their names to
    // render a header — so they come from PRAGMA, not from the first row.
    const columns = (
      this.db.prepare(`PRAGMA table_info('${name}')`).all() as TableInfoRow[]
    ).map((column) => column.name);
    const effectiveColumns = columns.length > 0 ? columns : rows.length > 0 ? Object.keys(rows[0]) : [];

    return {
      tableName: name,
      columns: effectiveColumns,
      rows: rows.map((row) => effectiveColumns.map((column) => row[column])),
      ...(hasRowIds ? { rowIds: rows.map((row) => Number(row[rowIdAlias])) } : {}),
      totalRows: total.count,
      limit,
      isTruncated: total.count > rows.length,
    };
  }

  // Whether a name can be queried for `rowid`. Every ordinary table can; a view
  // and a WITHOUT ROWID table cannot, and there is no pragma that says so
  // outright — so this asks SQLite the cheapest possible question and reads the
  // answer from whether it threw.
  private hasRowIds(resolvedName: string): boolean {
    try {
      this.db.prepare(`SELECT rowid FROM "${resolvedName}" LIMIT 0`).all();
      return true;
    } catch {
      return false;
    }
  }

  readBlobCell({ tableName, columnName, rowId }: BlobCellSource): Uint8Array | undefined {
    // Neither a table nor a column name can be a bound parameter, so both are
    // resolved against the schema first and the *stored* spellings are what get
    // interpolated. The rowid is bound. Nothing the caller typed reaches the SQL.
    const name = this.resolveReadableName(tableName);
    const column = this.resolveColumnName(name, columnName);

    const row = this.db
      .prepare(`SELECT "${column}" AS value FROM "${name}" WHERE rowid = ?`)
      .get(rowId) as { value: unknown } | undefined;
    if (!row) return undefined;

    const { value } = row;
    if (value === null || value === undefined) return undefined;
    // Only an actual BLOB is served. A TEXT or numeric cell is not a file, and
    // handing one back as a download would invite using this as a generic
    // exfiltration route for column values.
    if (!(value instanceof Uint8Array)) return undefined;
    return value;
  }

  // As resolveTableName, for a column: the name is checked against the table's
  // real columns and the stored spelling returned, so it can be interpolated.
  private resolveColumnName(resolvedTable: string, columnName: string): string {
    const columns = this.db
      .prepare(`PRAGMA table_info('${resolvedTable}')`)
      .all() as TableInfoRow[];
    const match = columns.find((column) => column.name === columnName);
    if (!match) throw new Error(`No such column: ${columnName}`);
    return match.name;
  }

  executeStatement(sql: string): SqlExecutionResult {
    const trimmed = sql.trim();
    if (READ_ONLY_STATEMENT_PATTERN.test(trimmed)) {
      const rows = this.db.prepare(trimmed).all() as Record<string, unknown>[];
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      return { kind: "query", columns, rows: rows.map((row) => columns.map((column) => row[column])) };
    }

    const result = this.db.prepare(trimmed).run();
    return { kind: "statement", changes: result.changes };
  }

  // A table name can't be a bound parameter — it has to be interpolated into the
  // SQL text. So it is looked up in sqlite_master first and the *stored* name is
  // used, never the caller's string. Anything not naming a real table throws
  // before any SQL is built.
  private resolveTableName(tableName: string): string {
    const row = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name = ?",
      )
      .get(tableName) as { name: string } | undefined;
    if (!row) throw new Error(`No such table: ${tableName}`);
    return row.name;
  }

  // As resolveTableName, but a view counts too: both can be read from.
  private resolveReadableName(tableName: string): string {
    const row = this.db
      .prepare(
        `SELECT name FROM sqlite_master
          WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' AND name = ?`,
      )
      .get(tableName) as { name: string } | undefined;
    if (!row) throw new Error(`No such table or view: ${tableName}`);
    return row.name;
  }

  countRows(tableName: string): number {
    const name = this.resolveTableName(tableName);
    const row = this.db.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get() as {
      count: number;
    };
    return row.count;
  }

  truncateTable(tableName: string): number {
    const name = this.resolveTableName(tableName);
    // One transaction: a DELETE that lands while the sequence reset fails would
    // leave the counter high, and the next insert would not start at 1.
    const run = this.db.transaction(() => {
      const deleted = this.db.prepare(`DELETE FROM "${name}"`).run().changes;
      // Only present when some table in the schema uses AUTOINCREMENT, and only
      // holds a row for tables that have been inserted into.
      const hasSequence = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'")
        .get();
      if (hasSequence) {
        this.db.prepare("DELETE FROM sqlite_sequence WHERE name = ?").run(name);
      }
      return deleted;
    });
    return run();
  }
}
