"use client";

import { useState } from "react";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type CellValue, type DataGridColumn } from "@/components/data-grid";
import type { SqlExecutionResult, TableInfo } from "@/lib/sql-explorer";
import { executeSqlAction } from "./actions";

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  return String(value);
}

// Narrow a raw SQLite cell (number | string | null | Buffer | bigint) to the
// grid's sortable/exportable primitive.
function toCellValue(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "string") return value;
  return String(value);
}

function QueryResultGrid({ result }: { result: Extract<SqlExecutionResult, { kind: "query" }> }) {
  const columns: DataGridColumn<unknown[]>[] = result.columns.map((columnName, columnIndex) => ({
    key: columnName,
    header: columnName,
    value: (row) => toCellValue(row[columnIndex]),
    render: (row) => formatCellValue(row[columnIndex]),
  }));

  return (
    <DataGrid
      columns={columns}
      rows={result.rows}
      getRowKey={(row) => JSON.stringify(row)}
      emptyMessage="Query returned no rows."
      exportFileName="query-results"
    />
  );
}

export function SqlExplorerView({ tables }: { tables: TableInfo[] }) {
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<SqlExecutionResult | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isRunning, setIsRunning] = useState(false);

  async function handleExecute(statement: string) {
    setIsRunning(true);
    setError(undefined);
    try {
      const response = await executeSqlAction(statement);
      if (!response.ok) {
        setError(response.error ?? "Failed to execute SQL.");
        setResult(undefined);
        return;
      }
      setResult(response.result);
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">Administration</p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">SQL Explorer</h1>
      <p className="mt-2 text-sm text-muted">
        Runs directly against this application&apos;s database — including tables outside the Stocks
        &amp; ETFs module. <code>SELECT</code>/<code>PRAGMA</code>/<code>EXPLAIN</code> return rows;
        anything else executes as a statement. There is no undo.
      </p>

      <div className="mt-6 flex flex-col gap-4">
        <textarea
          value={sql}
          onChange={(event) => setSql(event.target.value)}
          rows={6}
          placeholder="SELECT * FROM stock_positions"
          className="w-full rounded-md border border-line bg-paper px-3 py-2 font-mono text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
        <div>
          <Button onClick={() => handleExecute(sql)} disabled={isRunning || sql.trim() === ""}>
            {isRunning ? "Running…" : "Execute"}
          </Button>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        {result?.kind === "statement" && (
          <p className="text-sm text-ink">{result.changes} row(s) affected.</p>
        )}
        {result?.kind === "query" && <QueryResultGrid result={result} />}
      </div>

      <div className="mt-8">
        <CollapsibleCard title="Tables">
          <div className="flex flex-col gap-2">
            {tables.map((table) => (
              <div key={table.name} className="flex items-center justify-between border-b border-line py-2 last:border-b-0">
                <div>
                  <p className="text-sm font-medium text-ink">{table.name}</p>
                  <p className="text-xs text-muted">
                    {table.columns.map((column) => `${column.name} (${column.type})`).join(", ")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const statement = `SELECT * FROM ${table.name}`;
                    setSql(statement);
                    handleExecute(statement);
                  }}
                  className="shrink-0 text-xs font-medium text-brass-dark hover:underline"
                >
                  Open
                </button>
              </div>
            ))}
          </div>
        </CollapsibleCard>
      </div>
    </div>
  );
}
