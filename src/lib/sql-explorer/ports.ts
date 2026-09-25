import type { BlobCellSource } from "./blob-cells";
import type {
  SavedQuery,
  SaveQueryInput,
  SchemaObject,
  SqlExecutionResult,
  TableInfo,
  TablePage,
} from "./types";

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

/**
 * Storage for the SQL Query tab's saved statements.
 *
 * Deliberately separate from SqlExplorerRepository. That one is "run whatever
 * SQL you are given against the live database" -- dangerous by design, and
 * impossible to fake without stubbing ten unrelated methods. This is ordinary
 * CRUD over one table, so its fake is a few lines and its tests read as tests
 * of the use-cases rather than of a mock.
 */
export interface SavedQueryRepository {
  /** Every saved query, ordered by name. The card reads the whole list. */
  listSavedQueries(): SavedQuery[];
  /**
   * Inserts the query, or replaces the one already holding that name --
   * `sys_saved_sql_queries` is UNIQUE (name), which is what makes saving a
   * single path rather than a create/update branch. Returns the stored row.
   */
  upsertSavedQuery(input: SaveQueryInput): SavedQuery;
  /**
   * Deletes by id. Returns false when no row had that id, so the caller can
   * tell "deleted" from "was not there" rather than reporting both as success.
   */
  deleteSavedQuery(id: number): boolean;
}
