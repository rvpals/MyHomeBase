"use client";

import { useEffect, useState, type ReactNode } from "react";
import { BlobCell } from "@/components/blob-cell";
import { Button } from "@/components/button";
import { DataGrid, type CellValue, type DataGridColumn } from "@/components/data-grid";
import { CollapsibleCard } from "@/components/collapsible-card";
import { Modal } from "@/components/modal";
import { Tabs, type TabItem } from "@/components/tabs";
import { TreeNav, type TreeNavNode } from "@/components/tree-nav";
import { ModuleIcon } from "@/components/module-icons";
import { SlotIcon } from "@/components/slot-icon";
import { getIconSlot } from "@/lib/icons";
import {
  buildTableReference,
  describeTable,
  formatByteSize,
  isBlobCell,
  type BlobCellSource,
  type ModuleTableGroup,
  type SchemaObject,
  type SchemaObjectGroup,
  type SavedQuery,
  type SqlExecutionResult,
  type TableInfo,
  type TablePage,
} from "@/lib/sql-explorer";
import {
  countTableRowsAction,
  deleteSavedQueryAction,
  executeSqlAction,
  loadTablePageAction,
  saveQueryAction,
  truncateTableAction,
} from "./actions";
import { PAGE_CONTAINER } from "../../page-container";

/** The URL the blob route serves one cell's bytes from. */
function blobCellUrl(source: BlobCellSource, { download }: { download: boolean }): string {
  const params = new URLSearchParams({
    table: source.tableName,
    column: source.columnName,
    rowid: String(source.rowId),
  });
  if (download) params.set("download", "1");
  return `/api/admin/sql-explorer/blob?${params.toString()}`;
}

function formatCellValue(value: unknown): ReactNode {
  if (value === null || value === undefined) return "—";
  // A BLOB arrives as a descriptor, never as bytes — see lib/sql-explorer's
  // toDisplayValue. It renders as its type and size plus Save/Preview.
  if (isBlobCell(value)) {
    return (
      <BlobCell
        mimeType={value.mimeType}
        byteLength={value.byteLength}
        source={value.source}
        isPreviewable={value.isPreviewable}
        sizeLabel={formatByteSize(value.byteLength)}
        buildUrl={blobCellUrl}
      />
    );
  }
  return String(value);
}

// Narrow a cell to the grid's sortable/exportable primitive. A BLOB sorts and
// exports by its size: the bytes aren't here, and "how big is it" is the only
// question a column of files can usefully be ordered by.
function toCellValue(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (isBlobCell(value)) return value.byteLength;
  if (typeof value === "number" || typeof value === "string") return value;
  return String(value);
}

/**
 * One column per name, for a grid whose shape isn't known until the rows arrive.
 *
 * Shared by the query result and the browsed table: both render positionally
 * out of `unknown[]` rows, and the BLOB handling is fiddly enough that two
 * copies would drift.
 */
function buildColumns(columnNames: string[]): DataGridColumn<unknown[]>[] {
  return columnNames.map((columnName, columnIndex) => ({
    key: columnName,
    header: columnName,
    value: (row) => toCellValue(row[columnIndex]),
    render: (row) => formatCellValue(row[columnIndex]),
  }));
}

function QueryResultGrid({ result }: { result: Extract<SqlExecutionResult, { kind: "query" }> }) {
  return (
    <DataGrid
      columns={buildColumns(result.columns)}
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
  return (
    <DataGrid
      columns={buildColumns(page.columns)}
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
 * The selected table and its rows, for a tree that browses tables.
 *
 * Shared by the Tables Explorer and the Modules tab: both answer a leaf click by
 * reading a capped page and showing it, and the load/error/clear sequence is
 * fiddly enough that two copies would drift.
 */
function useTablePage() {
  const [page, setPage] = useState<TablePage | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function load(tableName: string) {
    setPage(undefined);
    setError(undefined);
    setIsLoading(true);
    try {
      const response = await loadTablePageAction(tableName);
      if (!response.ok) setError(response.error ?? "Failed to read the table.");
      else setPage(response.page);
    } finally {
      setIsLoading(false);
    }
  }

  function clear() {
    setPage(undefined);
    setError(undefined);
  }

  return { page, isLoading, error, load, clear };
}

/** The header above a browsed table — its name, purpose and row actions. */
function TablePanelHeader({
  tableName,
  onOpenInSql,
  onTruncate,
}: {
  tableName: string;
  onOpenInSql: (tableName: string) => void;
  onTruncate?: (tableName: string) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 max-lg:flex-col">
      <div className="min-w-0">
        <h3 className="font-mono text-sm font-semibold text-ink">{tableName}</h3>
        {describeTable(tableName) && (
          <p className="mt-1 text-xs text-muted">{describeTable(tableName)}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={() => onOpenInSql(tableName)}
          className="text-xs font-medium text-brass-dark hover:underline"
        >
          Open in SQL
        </button>
        {onTruncate && (
          <button
            type="button"
            onClick={() => onTruncate(tableName)}
            className="text-xs font-medium text-red-400 hover:underline"
          >
            Truncate
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Every table grouped by the module that owns it.
 *
 * The groups come from the live `sys_modules` registry, so the headings and
 * their order match the nav rail, and a module renamed on the Modules admin
 * screen is renamed here too. A module with no tables keeps its node — "Games
 * owns nothing yet" is worth saying — and everything no module owns (the
 * platform `sys_` tables, the icon overrides, a runtime CSV dataset) sits in the
 * trailing "Non-Modules" group, so no table can be hidden by this view.
 */
function ModulesExplorer({
  moduleGroups,
  onOpenInSql,
  onTruncate,
}: {
  moduleGroups: ModuleTableGroup[];
  onOpenInSql: (tableName: string) => void;
  onTruncate: (tableName: string) => void;
}) {
  const [selectedTable, setSelectedTable] = useState<string | undefined>(undefined);
  const { page, isLoading, error, load } = useTablePage();

  const nodes: TreeNavNode[] = moduleGroups.map((group) => ({
    id: group.key,
    // The prefix rides along in the label so the tree says *why* a table is
    // filed where it is — the grouping rule is otherwise invisible.
    label: group.prefix ? `${group.label} (${group.prefix})` : group.label,
    badge: group.tables.length,
    emptyMessage: group.isModule
      ? "This module owns no tables yet."
      : "Every table belongs to a module.",
    children: group.tables.map((table) => ({
      id: table.name,
      label: table.name,
      detail: table.description,
    })),
  }));

  const selectedGroup = moduleGroups.find((group) =>
    group.tables.some((table) => table.name === selectedTable),
  );

  async function handleSelect(tableName: string) {
    setSelectedTable(tableName);
    await load(tableName);
  }

  return (
    // Side by side on desktop; stacked below 1024px, where two columns would
    // leave neither the tree nor the grid usable.
    <div className="flex gap-4 max-lg:flex-col">
      <div className="shrink-0 overflow-y-auto rounded-md border border-line bg-paper-raised p-2 lg:w-72 lg:max-h-[70vh]">
        <TreeNav nodes={nodes} selectedId={selectedTable} onSelect={handleSelect} />
      </div>

      <div className="min-w-0 flex-1">
        {!selectedTable && (
          <p className="text-sm text-muted">
            Pick a table to browse it. Groups are the modules from the registry; anything no
            module owns is under <span className="text-ink">Non-Modules</span>.
          </p>
        )}

        {selectedTable && (
          <div className="flex flex-col gap-3">
            {selectedGroup && (
              <p className="flex items-center gap-2 text-xs text-muted">
                {selectedGroup.icon && (
                  <ModuleIcon name={selectedGroup.icon} className="h-4 w-4 shrink-0 text-brass-dark" />
                )}
                {selectedGroup.label}
              </p>
            )}

            <TablePanelHeader
              tableName={selectedTable}
              onOpenInSql={onOpenInSql}
              onTruncate={onTruncate}
            />

            {isLoading && <p className="text-sm text-muted">Loading…</p>}
            {error && <p className="text-sm text-red-400">{error}</p>}

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

/** The Saved SQL card's header mark. Static registry, so module scope is not I/O. */
const SAVED_SQL_SLOT = getIconSlot("admin_card_saved_sql")!;

/** Shared by the save dialog's three fields — the query textarea's styling, minus the mono face. */
const FIELD_CLASSES =
  "w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/**
 * Collects a name, description and tags for the statement in the editor.
 *
 * The name is the row's identity — `sys_saved_sql_queries` is UNIQUE (name) —
 * so reusing one replaces it. That is said in the dialog rather than discovered
 * afterwards: the warning appears as soon as the typed name matches something
 * already saved, and the confirm button changes to "Replace".
 */
function SaveQueryDialog({
  sql,
  savedQueries,
  onClose,
  onSaved,
}: {
  sql: string;
  savedQueries: SavedQuery[];
  onClose: () => void;
  onSaved: (queries: SavedQuery[], message: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  const trimmedName = name.trim();
  // Case-insensitive, matching the list's NOCASE ordering and how a reader reads
  // a list — "Totals" and "totals" are the same name to them. The database has
  // the final say either way; this only decides what the dialog says first.
  const willReplace = savedQueries.some(
    (query) => query.name.toLowerCase() === trimmedName.toLowerCase(),
  );

  async function handleSave() {
    setIsSaving(true);
    setError(undefined);
    try {
      const response = await saveQueryAction({
        name: trimmedName,
        description: description.trim(),
        tags,
        sqlStatement: sql,
      });
      if (!response.ok) {
        setError(response.error ?? "Failed to save the query.");
        return;
      }
      onSaved(
        response.queries ?? [],
        willReplace ? `Replaced "${trimmedName}".` : `Saved "${trimmedName}".`,
      );
      onClose();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal
      title="Save this query"
      description="Saved queries are shared by every admin."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving || trimmedName === ""}>
            {isSaving ? "Saving…" : willReplace ? "Replace" : "Save"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            maxLength={120}
            placeholder="Positions bought this year"
            className={FIELD_CLASSES}
          />
        </label>

        {willReplace && (
          <p className="text-sm text-red-400">
            A saved query is already called &ldquo;{trimmedName}&rdquo;. Saving replaces its
            description, tags and SQL.
          </p>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">Description</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
            maxLength={500}
            placeholder="What this answers, and anything to watch for."
            className={FIELD_CLASSES}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">Tags</span>
          <input
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="investments, debugging"
            className={FIELD_CLASSES}
          />
          <span className="text-xs text-muted">Separated by commas.</span>
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">SQL</span>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-paper px-3 py-2 font-mono text-xs text-muted">
            {sql}
          </pre>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>
    </Modal>
  );
}

/**
 * The saved statements, listed for loading and deleting.
 *
 * Load fills the editor and stops — it deliberately does NOT execute, unlike
 * the Tables tree's "Open in SQL". A saved statement may be a DELETE, and a
 * single click from a list is the wrong gesture to run one with.
 */
function SavedQueriesCard({
  savedQueries,
  onLoad,
  onDeleted,
  onError,
}: {
  savedQueries: SavedQuery[];
  onLoad: (query: SavedQuery) => void;
  onDeleted: (queries: SavedQuery[], message: string) => void;
  onError: (message: string) => void;
}) {
  const [deletingId, setDeletingId] = useState<number | undefined>(undefined);

  async function handleDelete(query: SavedQuery) {
    // A plain confirm rather than a second Modal: deleting one saved statement
    // is small and undone by saving it again, so a full dialog would be heavier
    // than the decision. Truncate, which is neither, keeps its dialog.
    if (!window.confirm(`Delete the saved query "${query.name}"?`)) return;
    setDeletingId(query.id);
    try {
      const response = await deleteSavedQueryAction(query.id);
      if (!response.ok) {
        onError(response.error ?? "Failed to delete the saved query.");
        return;
      }
      onDeleted(response.queries ?? [], `Deleted "${query.name}".`);
    } finally {
      setDeletingId(undefined);
    }
  }

  const columns: DataGridColumn<SavedQuery>[] = [
    {
      key: "name",
      header: "Name",
      value: (query) => query.name,
      render: (query) => <span className="font-medium text-ink">{query.name}</span>,
      minWidth: 160,
    },
    {
      key: "description",
      header: "Description",
      value: (query) => query.description,
      render: (query) => (
        <span className="text-muted">{query.description === "" ? "—" : query.description}</span>
      ),
      minWidth: 200,
    },
    {
      key: "tags",
      header: "Tags",
      // Sorts and exports as the joined string; renders as chips.
      value: (query) => query.tags.join(", "),
      render: (query) =>
        query.tags.length === 0 ? (
          <span className="text-muted">—</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {query.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-line bg-paper px-2 py-0.5 text-xs text-muted"
              >
                {tag}
              </span>
            ))}
          </span>
        ),
      minWidth: 140,
    },
    {
      key: "sqlStatement",
      header: "SQL",
      value: (query) => query.sqlStatement,
      render: (query) => (
        <span className="line-clamp-2 font-mono text-xs text-muted">{query.sqlStatement}</span>
      ),
      minWidth: 220,
    },
    {
      key: "updatedAt",
      header: "Updated",
      value: (query) => query.updatedAt,
      render: (query) => <span className="text-muted">{query.updatedAt}</span>,
      minWidth: 140,
    },
    {
      key: "actions",
      header: "",
      sortable: false,
      value: () => null,
      render: (query) => (
        <span className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => onLoad(query)}>
            Load
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => handleDelete(query)}
            disabled={deletingId === query.id}
          >
            {deletingId === query.id ? "Deleting…" : "Delete"}
          </Button>
        </span>
      ),
      excludeFromRecordView: true,
    },
  ];

  return (
    <CollapsibleCard
      title="Saved SQL"
      titleIcon={<SlotIcon slot={SAVED_SQL_SLOT} className="h-4 w-4" />}
    >
      <DataGrid
        columns={columns}
        rows={savedQueries}
        getRowKey={(query) => query.id}
        emptyMessage="Nothing saved yet — run a query, then press Save."
        exportFileName="saved-sql"
      />
    </CollapsibleCard>
  );
}

export function SqlExplorerView({
  tables,
  schemaGroups,
  moduleGroups,
  savedQueries: initialSavedQueries,
}: {
  tables: TableInfo[];
  schemaGroups: SchemaObjectGroup[];
  moduleGroups: ModuleTableGroup[];
  savedQueries: SavedQuery[];
}) {
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<SqlExecutionResult | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isRunning, setIsRunning] = useState(false);
  const [truncateTarget, setTruncateTarget] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [activeTab, setActiveTab] = useState("query");
  // Server-rendered once, then owned here: save and delete both return the
  // whole refreshed list, so the card stays correct without a router refresh.
  const [savedQueries, setSavedQueries] = useState(initialSavedQueries);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);

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
        placeholder="SELECT * FROM inv_stock_positions"
        className="w-full rounded-md border border-line bg-paper px-3 py-2 font-mono text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
      />
      {/* Wraps to two full-width buttons on a phone; side by side from 1024px. */}
      <div className="flex gap-2 max-lg:flex-col">
        <Button onClick={() => handleExecute(sql)} disabled={isRunning || sql.trim() === ""}>
          {isRunning ? "Running…" : "Execute"}
        </Button>
        {/* Saving does not require having run the statement first — a query
            worth keeping is often one still being written. */}
        <Button
          variant="secondary"
          onClick={() => setIsSaveDialogOpen(true)}
          disabled={sql.trim() === ""}
        >
          Save
        </Button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {result?.kind === "statement" && (
        <p className="text-sm text-ink">{result.changes} row(s) affected.</p>
      )}
      {result?.kind === "query" && <QueryResultGrid result={result} />}

      <SavedQueriesCard
        savedQueries={savedQueries}
        onLoad={loadSavedQuery}
        onDeleted={(queries, message) => {
          setSavedQueries(queries);
          setNotice(message);
        }}
        onError={setError}
      />
    </div>
  );

  /**
   * Puts a saved statement in the editor without running it.
   *
   * Deliberately unlike `openInSql` below, which does execute: that one builds
   * its own `SELECT * FROM <table>` and knows it is safe, whereas a saved
   * statement is whatever an admin stored — possibly a DELETE. The reader
   * presses Execute.
   */
  function loadSavedQuery(query: SavedQuery) {
    setSql(query.sqlStatement);
    setResult(undefined);
    setError(undefined);
    setNotice(`Loaded "${query.name}" — press Execute to run it.`);
  }

  // Shared by both trees: drop a SELECT into the query tab and follow it over,
  // since that's where the result grid lives.
  function openInSql(tableName: string) {
    const statement = `SELECT * FROM ${tableName}`;
    setSql(statement);
    setActiveTab("query");
    handleExecute(statement);
  }

  function confirmTruncate(tableName: string) {
    setNotice(undefined);
    setTruncateTarget(tableName);
  }

  const tablesTab = (
    <div className="flex flex-col gap-6">
      <TableReferenceCard tables={tables} />

      <SchemaExplorer
        schemaGroups={schemaGroups}
        onOpenInSql={openInSql}
        onTruncate={confirmTruncate}
      />
    </div>
  );

  const modulesTab = (
    <ModulesExplorer
      moduleGroups={moduleGroups}
      onOpenInSql={openInSql}
      onTruncate={confirmTruncate}
    />
  );

  const tabs: TabItem[] = [
    { key: "query", label: "SQL Query", content: queryTab },
    { key: "tables", label: "Tables Explorer", content: tablesTab },
    { key: "modules", label: "Modules", content: modulesTab },
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

      {isSaveDialogOpen && (
        <SaveQueryDialog
          sql={sql}
          savedQueries={savedQueries}
          onClose={() => setIsSaveDialogOpen(false)}
          onSaved={(queries, message) => {
            setSavedQueries(queries);
            setNotice(message);
          }}
        />
      )}

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
