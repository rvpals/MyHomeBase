"use server";

import {
  countTableRows,
  deleteSavedQuery,
  executeStatement,
  listSavedQueries,
  readTablePage,
  saveQuery,
  truncateTable,
} from "@/lib/sql-explorer";
import type { SavedQuery, SqlExecutionResult, TablePage } from "@/lib/sql-explorer";
import { deps } from "@/lib/wiring";
import { requireAdmin } from "../../require-access";

export interface ExecuteResult {
  ok: boolean;
  result?: SqlExecutionResult;
  error?: string;
}

export async function executeSqlAction(sql: string): Promise<ExecuteResult> {
  try {
    await requireAdmin();
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
    await requireAdmin();
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
    await requireAdmin();
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
    await requireAdmin();
    return { ok: true, page: readTablePage(deps.sqlExplorerRepo, tableName) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to read the table.",
    };
  }
}

export interface SavedQueryListResult {
  ok: boolean;
  queries?: SavedQuery[];
  error?: string;
}

/** Backs the Saved SQL card's refresh after a save or a delete. */
export async function listSavedQueriesAction(): Promise<SavedQueryListResult> {
  try {
    await requireAdmin();
    return { ok: true, queries: listSavedQueries(deps.savedQueryRepo) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to read the saved queries.",
    };
  }
}

export interface SaveQueryResult {
  ok: boolean;
  queries?: SavedQuery[];
  error?: string;
}

/**
 * Saves a statement under a name, replacing whatever held that name before —
 * the table is UNIQUE (name). The dialog warns before overwriting.
 *
 * Returns the whole refreshed list rather than the saved row, so the card is
 * correct in one round trip whichever branch the upsert took.
 */
export async function saveQueryAction(input: {
  name: string;
  description: string;
  tags: string;
  sqlStatement: string;
}): Promise<SaveQueryResult> {
  try {
    await requireAdmin();
    saveQuery(deps.savedQueryRepo, input);
    return { ok: true, queries: listSavedQueries(deps.savedQueryRepo) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to save the query.",
    };
  }
}

export interface DeleteSavedQueryResult {
  ok: boolean;
  queries?: SavedQuery[];
  error?: string;
}

/** Removes one saved query. The view confirms with the reader first. */
export async function deleteSavedQueryAction(id: number): Promise<DeleteSavedQueryResult> {
  try {
    await requireAdmin();
    deleteSavedQuery(deps.savedQueryRepo, id);
    return { ok: true, queries: listSavedQueries(deps.savedQueryRepo) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to delete the saved query.",
    };
  }
}
