import type { SqlExecutionResult, TableInfo } from "./types";

export interface SqlExplorerRepository {
  listTables(): TableInfo[];
  /** Runs arbitrary SQL. SELECT/PRAGMA/EXPLAIN return rows; anything else runs as a statement. */
  executeStatement(sql: string): SqlExecutionResult;
  /** How many rows `tableName` holds. Throws if the table doesn't exist. */
  countRows(tableName: string): number;
  /**
   * Deletes every row from `tableName` and resets its AUTOINCREMENT counter, so
   * the next insert starts at 1. Returns the number of rows deleted.
   *
   * Throws if the table doesn't exist. SQLite has no TRUNCATE; this is a
   * `DELETE FROM` plus a `sqlite_sequence` clear, in one transaction.
   */
  truncateTable(tableName: string): number;
}
