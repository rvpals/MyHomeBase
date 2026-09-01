import type Database from "better-sqlite3";
import type { SqlExplorerRepository } from "./ports";
import type { SqlExecutionResult, TableInfo } from "./types";

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
