import type { BlobCellSource } from "./blob-cells";
import type { SchemaObject, SqlExecutionResult, TableInfo, TablePage } from "./types";

export interface SqlExplorerRepository {
  listTables(): TableInfo[];
  /** Every table, view, index and trigger in the file, SQLite's internals aside. */
  listSchemaObjects(): SchemaObject[];
  /**
   * Up to `limit` rows of `tableName`, plus the table's full row count so the
   * caller can say how much it isn't showing. Throws if the table doesn't exist.
   */
  readTablePage(tableName: string, limit: number): TablePage;
  /** Runs arbitrary SQL. SELECT/PRAGMA/EXPLAIN return rows; anything else runs as a statement. */
  executeStatement(sql: string): SqlExecutionResult;
  /** How many rows `tableName` holds. Throws if the table doesn't exist. */
  countRows(tableName: string): number;
  /**
   * The raw bytes of one BLOB cell, or undefined when the row, column or value
   * isn't there. Backs the Save/Preview actions on a blob cell: the bytes are
   * deliberately fetched one at a time rather than travelling with the rows.
   *
   * Throws if the table or column doesn't exist — both are resolved against the
   * schema before any SQL is built, since neither can be a bound parameter.
   */
  readBlobCell(source: BlobCellSource): Uint8Array | undefined;
  /**
   * Deletes every row from `tableName` and resets its AUTOINCREMENT counter, so
   * the next insert starts at 1. Returns the number of rows deleted.
   *
   * Throws if the table doesn't exist. SQLite has no TRUNCATE; this is a
   * `DELETE FROM` plus a `sqlite_sequence` clear, in one transaction.
   */
  truncateTable(tableName: string): number;
}
