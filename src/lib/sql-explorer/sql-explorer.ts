import type { SqlExplorerRepository } from "./ports";
import { readOnlySqlStatementSchema, sqlStatementSchema } from "./schema";
import type { SqlExecutionResult, TableInfo } from "./types";

export function listTables(repo: SqlExplorerRepository): TableInfo[] {
  return repo.listTables();
}

export function executeStatement(repo: SqlExplorerRepository, sql: string): SqlExecutionResult {
  const validated = sqlStatementSchema.parse(sql);
  return repo.executeStatement(validated);
}

export interface ReadOnlyQueryResult {
  columns: string[];
  rows: unknown[][];
}

/**
 * Runs a SELECT and returns its rows. Unlike `executeStatement` (the
 * intentionally unrestricted admin tool), this refuses anything that isn't a
 * SELECT, so it's safe to expose on a surface that isn't the SQL Explorer.
 * Throws rather than returning a partial result if the statement was not a query.
 */
export function executeReadOnlyQuery(
  repo: SqlExplorerRepository,
  sql: string,
): ReadOnlyQueryResult {
  const validated = readOnlySqlStatementSchema.parse(sql);
  const result = repo.executeStatement(validated);
  // Defence in depth: a non-query result means the statement slipped past the
  // SELECT check, so surface it loudly instead of reporting success.
  if (result.kind !== "query") {
    throw new Error("Only SELECT queries are allowed here.");
  }
  return { columns: result.columns, rows: result.rows };
}
