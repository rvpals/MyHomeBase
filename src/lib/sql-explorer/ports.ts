import type { SqlExecutionResult, TableInfo } from "./types";

export interface SqlExplorerRepository {
  listTables(): TableInfo[];
  /** Runs arbitrary SQL. SELECT/PRAGMA/EXPLAIN return rows; anything else runs as a statement. */
  executeStatement(sql: string): SqlExecutionResult;
}
