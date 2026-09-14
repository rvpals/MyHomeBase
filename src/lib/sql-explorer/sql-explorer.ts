import type { SqlExplorerRepository } from "./ports";
import { toDisplayValue } from "./schema-objects";
import { readOnlySqlStatementSchema, sqlStatementSchema, tableNameSchema } from "./schema";
import type { SqlExecutionResult, TableInfo } from "./types";

export function listTables(repo: SqlExplorerRepository): TableInfo[] {
  return repo.listTables();
}

export function executeStatement(repo: SqlExplorerRepository, sql: string): SqlExecutionResult {
  const validated = sqlStatementSchema.parse(sql);
  const result = repo.executeStatement(validated);
  if (result.kind !== "query") return result;

  // A `SELECT *` over a table with an image column would otherwise serialise
  // whole files into the response, one per row. Describing them keeps the
  // Query tab's payload the same size as the Tables Explorer's.
  //
  // No address is attached: an arbitrary SELECT has no rowid to quote — it may
  // be a join, an expression, or a view — so a blob found here renders as a
  // summary with Save and Preview disabled. Browsing the table gives the
  // buttons; see BlobCell.source.
  return {
    ...result,
    rows: result.rows.map((row) => row.map((value) => toDisplayValue(value))),
  };
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
  return {
    columns: result.columns,
    rows: result.rows.map((row) => row.map((value) => toDisplayValue(value))),
  };
}

/** How many rows a table currently holds — the number the truncate warning quotes. */
export function countTableRows(repo: SqlExplorerRepository, tableName: string): number {
  return repo.countRows(tableNameSchema.parse(tableName));
}

/**
 * Deletes every row from a table and resets its id counter, returning the count
 * deleted.
 *
 * Irreversible and takes no backup — the caller is responsible for confirming
 * with the reader first. Read the count with `countTableRows` to say how much is
 * about to go.
 */
export function truncateTable(repo: SqlExplorerRepository, tableName: string): number {
  return repo.truncateTable(tableNameSchema.parse(tableName));
}
