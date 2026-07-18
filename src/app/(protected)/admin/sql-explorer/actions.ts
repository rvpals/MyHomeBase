"use server";

import { executeStatement } from "@/lib/sql-explorer";
import type { SqlExecutionResult } from "@/lib/sql-explorer";
import { deps } from "@/lib/wiring";

export interface ExecuteResult {
  ok: boolean;
  result?: SqlExecutionResult;
  error?: string;
}

export async function executeSqlAction(sql: string): Promise<ExecuteResult> {
  try {
    const result = executeStatement(deps.sqlExplorerRepo, sql);
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to execute SQL." };
  }
}
