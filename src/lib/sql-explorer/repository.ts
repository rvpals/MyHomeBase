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
}
