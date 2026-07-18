import type { SqlExplorerRepository } from "./ports";
import { sqlStatementSchema } from "./schema";
import type { SqlExecutionResult, TableInfo } from "./types";

export function listTables(repo: SqlExplorerRepository): TableInfo[] {
  return repo.listTables();
}

export function executeStatement(repo: SqlExplorerRepository, sql: string): SqlExecutionResult {
  const validated = sqlStatementSchema.parse(sql);
  return repo.executeStatement(validated);
}
