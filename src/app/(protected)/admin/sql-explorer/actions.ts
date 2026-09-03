"use server";

import { countTableRows, executeStatement, readTablePage, truncateTable } from "@/lib/sql-explorer";
import type { SqlExecutionResult, TablePage } from "@/lib/sql-explorer";
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

export interface CountRowsResult {
  ok: boolean;
  count?: number;
  error?: string;
}

/** Backs the truncate warning's row count, read when the dialog opens. */
export async function countTableRowsAction(tableName: string): Promise<CountRowsResult> {
  try {
    return { ok: true, count: countTableRows(deps.sqlExplorerRepo, tableName) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to count rows.",
    };
  }
}

export interface TruncateResult {
  ok: boolean;
  deleted?: number;
  error?: string;
}

/**
 * Empties a table and resets its id counter. Irreversible — the view confirms
 * with the reader before calling this.
 */
export async function truncateTableAction(tableName: string): Promise<TruncateResult> {
  try {
    return { ok: true, deleted: truncateTable(deps.sqlExplorerRepo, tableName) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to truncate the table.",
    };
  }
}

export interface TablePageResult {
  ok: boolean;
  page?: TablePage;
  error?: string;
}

/**
 * Backs the tree explorer's right-hand grid. Capped at TABLE_PAGE_LIMIT rows —
 * the grid takes the rows it is given, so an uncapped read of a large table
 * would be sent to the browser in full.
 */
export async function loadTablePageAction(tableName: string): Promise<TablePageResult> {
  try {
    return { ok: true, page: readTablePage(deps.sqlExplorerRepo, tableName) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to read the table.",
    };
  }
}
