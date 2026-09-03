"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { DataGrid, type CellValue, type DataGridColumn } from "@/components/data-grid";
import { CollapsibleCard } from "@/components/collapsible-card";
import { Modal } from "@/components/modal";
import { Tabs, type TabItem } from "@/components/tabs";
import { TreeNav, type TreeNavNode } from "@/components/tree-nav";
import {
  buildTableReference,
  describeTable,
  type SchemaObject,
  type SchemaObjectGroup,
  type SqlExecutionResult,
  type TableInfo,
  type TablePage,
} from "@/lib/sql-explorer";
import {
  countTableRowsAction,
  executeSqlAction,
  loadTablePageAction,
  truncateTableAction,
} from "./actions";
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

// What each table is for, grouped by module. Static reference prose — SQLite has
// nowhere to keep a table comment, so the copy lives in the library alongside a
// test that every listed table carries a description.
function TableReferenceCard({ tables }: { tables: TableInfo[] }) {
  const groups = buildTableReference(tables.map((table) => table.name));

  return (
    <CollapsibleCard title="Table references">
      <div className="flex flex-col gap-6">
        {groups.map((group) => (
          <section key={group.module}>
            <h3 className="text-sm font-semibold text-ink">
              {group.module}
              {group.prefix && (
                <code className="ml-2 font-mono text-xs font-normal text-muted">{group.prefix}</code>
              )}
            </h3>
            {group.summary && <p className="mt-1 text-xs text-muted">{group.summary}</p>}

            <dl className="mt-3 flex flex-col gap-2">
              {group.tables.map(([name, description]) => (
                // Stacks on a phone; the name takes a fixed column on desktop so
                // the descriptions line up down the card.
                <div
                  key={name}
                  className="border-b border-line pb-2 last:border-b-0 last:pb-0 lg:flex lg:gap-4"
                >
                  <dt className="font-mono text-xs text-brass-dark lg:w-64 lg:shrink-0">{name}</dt>
                  <dd className="text-xs text-muted max-lg:mt-0.5 lg:flex-1">{description}</dd>
                </div>
              ))}
            </dl>

            {group.note && <p className="mt-2 text-xs italic text-muted">{group.note}</p>}
          </section>
        ))}
      </div>
    </CollapsibleCard>
  );
}

/** The rows of one table, as the right-hand grid renders them. */
function TablePageGrid({ page }: { page: TablePage }) {
  const columns: DataGridColumn<unknown[]>[] = page.columns.map((columnName, columnIndex) => ({
    key: columnName,
    header: columnName,
    value: (row) => toCellValue(row[columnIndex]),
    render: (row) => formatCellValue(row[columnIndex]),
  }));

  return (
    <DataGrid
      columns={columns}
      rows={page.rows}
      getRowKey={(row) => JSON.stringify(row)}
      emptyMessage="This table has no rows."
      exportFileName={page.tableName}
      storageKey={`sql-explorer-browse-${page.tableName}`}
    />
  );
}

/** An index or trigger has no rows of its own — its definition is the content. */
function DefinitionPanel({ object }: { object: SchemaObject }) {
  return (
    <div className="flex flex-col gap-3">
      {object.tableName && (
        <p className="text-sm text-muted">
          On table <code className="font-mono text-brass-dark">{object.tableName}</code>
        </p>
      )}
      {object.sql ? (
        <pre className="overflow-x-auto rounded-md border border-line bg-paper p-3 font-mono text-xs text-ink">
          {object.sql}
        </pre>
      ) : (
        // SQLite creates an index of its own to back a PRIMARY KEY or UNIQUE
        // constraint, and stores no SQL for it. Saying so beats an empty box.
        <p className="text-sm text-muted">
          SQLite created this automatically to enforce a PRIMARY KEY or UNIQUE constraint, so it has
          no CREATE statement of its own.
        </p>
      )}
    </div>
  );
}

/**
 * The schema tree and the panel it drives.
 *
 * Selection is a kind plus a name, because a trigger and its table can share a
 * name and the tree has to tell them apart.
 */
function SchemaExplorer({
  schemaGroups,
  onOpenInSql,
  onTruncate,
}: {
  schemaGroups: SchemaObjectGroup[];
  onOpenInSql: (tableName: string) => void;
  onTruncate: (tableName: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [page, setPage] = useState<TablePage | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const selected = findSelected(schemaGroups, selectedId);

  const nodes: TreeNavNode[] = schemaGroups.map((group) => ({
    id: group.kind,
    label: group.label,
    badge: group.objects.length,
    emptyMessage: `No ${group.label.toLowerCase()} in this database.`,
    children: group.objects.map((object) => ({
      id: `${object.kind}:${object.name}`,
      label: object.name,
      detail: object.kind === "table" ? describeTable(object.name) : object.tableName,
    })),
  }));

  async function handleSelect(leafId: string) {
    setSelectedId(leafId);
    setPage(undefined);
    setError(undefined);

    const object = findSelected(schemaGroups, leafId);
    // Only a table or a view holds rows; the other two show their definition.
    if (!object || (object.kind !== "table" && object.kind !== "view")) return;

    setIsLoading(true);
    try {
      const response = await loadTablePageAction(object.name);
      if (!response.ok) setError(response.error ?? "Failed to read the table.");
      else setPage(response.page);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    // Side by side on desktop; stacked below 1024px, where two columns would
    // leave neither the tree nor the grid usable.
    <div className="flex gap-4 max-lg:flex-col">
      <div className="shrink-0 overflow-y-auto rounded-md border border-line bg-paper-raised p-2 lg:w-72 lg:max-h-[70vh]">
        <TreeNav nodes={nodes} selectedId={selectedId} onSelect={handleSelect} />
      </div>

      <div className="min-w-0 flex-1">
        {!selected && (
          <p className="text-sm text-muted">Pick a table, view, index or trigger from the tree.</p>
        )}

        {selected && (
          <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3 max-lg:flex-col">
              <div className="min-w-0">
                <h3 className="font-mono text-sm font-semibold text-ink">{selected.name}</h3>
                {selected.kind === "table" && describeTable(selected.name) && (
                  <p className="mt-1 text-xs text-muted">{describeTable(selected.name)}</p>
                )}
              </div>

              {(selected.kind === "table" || selected.kind === "view") && (
                <div className="flex shrink-0 items-center gap-3">
                  <button
                    type="button"
                    onClick={() => onOpenInSql(selected.name)}
                    className="text-xs font-medium text-brass-dark hover:underline"
                  >
                    Open in SQL
                  </button>
                  {selected.kind === "table" && (
                    <button
                      type="button"
                      onClick={() => onTruncate(selected.name)}
                      className="text-xs font-medium text-red-400 hover:underline"
                    >
                      Truncate
                    </button>
                  )}
                </div>
              )}
            </div>

            {isLoading && <p className="text-sm text-muted">Loading…</p>}
            {error && <p className="text-sm text-red-400">{error}</p>}

            {(selected.kind === "index" || selected.kind === "trigger") && (
              <DefinitionPanel object={selected} />
            )}

            {page && (
              <>
                {page.isTruncated && (
                  <p className="text-xs text-muted">
                    Showing the first {page.rows.length.toLocaleString()} of{" "}
                    {page.totalRows.toLocaleString()} rows. Use the SQL Query tab for the full set.
                  </p>
                )}
                <TablePageGrid page={page} />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Resolves a "kind:name" leaf id back to the object it names. */
function findSelected(
  groups: SchemaObjectGroup[],
  leafId: string | undefined,
): SchemaObject | undefined {
  if (!leafId) return undefined;
  const separator = leafId.indexOf(":");
  const kind = leafId.slice(0, separator);
  const name = leafId.slice(separator + 1);
  return groups
    .find((group) => group.kind === kind)
    ?.objects.find((object) => object.name === name);
}

export function SqlExplorerView({
  tables,
  schemaGroups,
}: {
  tables: TableInfo[];
  schemaGroups: SchemaObjectGroup[];
}) {
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<SqlExecutionResult | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isRunning, setIsRunning] = useState(false);
  const [truncateTarget, setTruncateTarget] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [activeTab, setActiveTab] = useState("query");

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

  const queryTab = (
    <div className="flex flex-col gap-4">
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
  );

  const tablesTab = (
    <div className="flex flex-col gap-6">
      <TableReferenceCard tables={tables} />

      <SchemaExplorer
        schemaGroups={schemaGroups}
        onOpenInSql={(tableName) => {
          const statement = `SELECT * FROM ${tableName}`;
          setSql(statement);
          // The grid lives on the other tab, so follow the result over.
          setActiveTab("query");
          handleExecute(statement);
        }}
        onTruncate={(tableName) => {
          setNotice(undefined);
          setTruncateTarget(tableName);
        }}
      />
    </div>
  );

  const tabs: TabItem[] = [
    { key: "query", label: "SQL Query", content: queryTab },
    { key: "tables", label: "Tables Explorer", content: tablesTab },
  ];

  return (
    <div className={PAGE_CONTAINER}>
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">Administration</p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">SQL Explorer</h1>
      <p className="mt-2 text-sm text-muted">
        Runs directly against this application&apos;s database — including tables outside the Stocks
        &amp; ETFs module. <code>SELECT</code>/<code>PRAGMA</code>/<code>EXPLAIN</code> return rows;
        anything else executes as a statement. There is no undo.
      </p>

      <Tabs
        className="mt-6"
        items={tabs}
        activeKey={activeTab}
        onActiveKeyChange={setActiveTab}
      />

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
