"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type CellValue, type DataGridColumn } from "@/components/data-grid";
import { Modal } from "@/components/modal";
import type { SqlExecutionResult, TableInfo } from "@/lib/sql-explorer";
import { countTableRowsAction, executeSqlAction, truncateTableAction } from "./actions";
import { PAGE_CONTAINER } from "../../page-container";

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

// Confirms emptying a table. The row count is read when the dialog opens rather
// than passed in: the page's table list is server-rendered and could be minutes
// stale, and "are you sure" is worth stating against the current number.
function TruncateDialog({
  tableName,
  onClose,
  onTruncated,
}: {
  tableName: string;
  onClose: () => void;
  onTruncated: (message: string) => void;
}) {
  const [count, setCount] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isTruncating, setIsTruncating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    countTableRowsAction(tableName).then((response) => {
      if (cancelled) return;
      if (!response.ok) setError(response.error ?? "Failed to count rows.");
      else setCount(response.count);
    });
    return () => {
      cancelled = true;
    };
  }, [tableName]);

  async function handleTruncate() {
    setIsTruncating(true);
    setError(undefined);
    try {
      const response = await truncateTableAction(tableName);
      if (!response.ok) {
        setError(response.error ?? "Failed to truncate the table.");
        return;
      }
      onTruncated(`Truncated ${tableName} — ${response.deleted ?? 0} row(s) deleted.`);
      onClose();
    } finally {
      setIsTruncating(false);
    }
  }

  return (
    <Modal
      title={`Truncate ${tableName}`}
      onClose={onClose}
      size="sm"
      isBusy={isTruncating}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isTruncating}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={handleTruncate}
            // Held until the count lands, so the reader always confirms against
            // a number rather than a blank.
            disabled={isTruncating || count === undefined}
          >
            {isTruncating ? "Truncating…" : "Truncate"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink">
          {count === undefined
            ? "Counting rows…"
            : `There are ${count.toLocaleString()} record(s) in table ${tableName}, are you sure?`}
        </p>
        <p className="text-sm text-red-400">
          Every row is deleted and the id counter resets to 1. This cannot be undone.
        </p>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>
    </Modal>
  );
}

export function SqlExplorerView({ tables }: { tables: TableInfo[] }) {
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<SqlExecutionResult | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isRunning, setIsRunning] = useState(false);
  const [truncateTarget, setTruncateTarget] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);

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
    <div className={PAGE_CONTAINER}>
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
          placeholder="SELECT * FROM stk_stock_positions"
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
                {/* min-w-0 so the column list can shrink instead of shoving the
                    actions off a narrow screen; the list itself truncates to one
                    line on a phone and wraps as before on desktop. */}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{table.name}</p>
                  <p className="text-xs text-muted max-lg:truncate">
                    {table.columns.map((column) => `${column.name} (${column.type})`).join(", ")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      const statement = `SELECT * FROM ${table.name}`;
                      setSql(statement);
                      handleExecute(statement);
                    }}
                    className="text-xs font-medium text-brass-dark hover:underline"
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNotice(undefined);
                      setTruncateTarget(table.name);
                    }}
                    className="text-xs font-medium text-red-400 hover:underline"
                  >
                    Truncate
                  </button>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleCard>
      </div>

      {notice && <p className="mt-4 text-sm text-ink">{notice}</p>}

      {truncateTarget !== undefined && (
        <TruncateDialog
          tableName={truncateTarget}
          onClose={() => setTruncateTarget(undefined)}
          onTruncated={(message) => {
            setNotice(message);
            // The grid on screen may be a SELECT from the table just emptied.
            setResult(undefined);
          }}
        />
      )}
    </div>
  );
}
