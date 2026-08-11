"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import type { NamedMapping } from "@/lib/csv-import";
import type {
  JournalEntry,
  JournalPreferences,
  JournalTaxonomyCount,
  TodayInHistoryEntry,
} from "@/lib/journal";
import { JournalEntryForm } from "./journal-entry-form";
import { JournalImportView } from "./journal-import-view";
import { runJournalSqlAction } from "./journal-actions";

const COLUMNS: DataGridColumn<JournalEntry>[] = [
  { key: "date", header: "Date", value: (entry) => entry.date, render: (entry) => entry.date },
  { key: "time", header: "Time", value: (entry) => entry.time, render: (entry) => entry.time },
  { key: "title", header: "Title", value: (entry) => entry.title, render: (entry) => entry.title },
  {
    key: "categories",
    header: "Categories",
    value: (entry) => entry.categories.join(", "),
    render: (entry) => entry.categories.join(", "),
  },
  {
    key: "tags",
    header: "Tags",
    value: (entry) => entry.tags.join(", "),
    render: (entry) => entry.tags.join(", "),
  },
  { key: "place", header: "Place", value: (entry) => entry.placeName, render: (entry) => entry.placeName },
  {
    key: "locations",
    header: "Locations",
    value: (entry) => entry.locations.length,
    render: (entry) => (entry.locations.length > 0 ? String(entry.locations.length) : ""),
  },
];

function yearsAgoLabel(yearsAgo: number): string {
  return yearsAgo === 1 ? "1 year ago" : `${yearsAgo} years ago`;
}

const TODAY_IN_HISTORY_COLUMNS: DataGridColumn<TodayInHistoryEntry>[] = [
  {
    key: "yearsAgo",
    header: "When",
    value: (item) => item.yearsAgo,
    render: (item) => yearsAgoLabel(item.yearsAgo),
  },
  { key: "date", header: "Date", value: (item) => item.entry.date, render: (item) => item.entry.date },
  { key: "title", header: "Title", value: (item) => item.entry.title, render: (item) => item.entry.title },
  {
    key: "categories",
    header: "Categories",
    value: (item) => item.entry.categories.join(", "),
    render: (item) => item.entry.categories.join(", "),
  },
];

// The single-query equivalent of what listRecentEntries produces. The real read
// is a parent query plus per-entry child queries assembled into an aggregate, so
// this flattens the child tables with GROUP_CONCAT to give one comparable row
// per entry — it's what the "Show SQL" dialog opens with and re-runs.
function equivalentSql(limit: number): string {
  return `SELECT
  e.id,
  e.entry_date,
  e.entry_time,
  e.title,
  e.place_name,
  (SELECT GROUP_CONCAT(c.category_name, ', ')
     FROM jrn_entry_categories c WHERE c.entry_id = e.id) AS categories,
  (SELECT GROUP_CONCAT(t.tag_name, ', ')
     FROM jrn_entry_tags t WHERE t.entry_id = e.id) AS tags,
  (SELECT COUNT(*)
     FROM jrn_entry_locations l WHERE l.entry_id = e.id) AS locations
FROM jrn_entries e
ORDER BY e.entry_date DESC, e.entry_time DESC, e.id DESC
LIMIT ${limit}`;
}

interface SqlResultRow {
  index: number;
  cells: unknown[];
}

function cellToText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

export function JournalView({
  entries,
  todayInHistory,
  topTags,
  topCategories,
  categoryOptions,
  tagOptions,
  preferences,
  namedMappings,
  canRunSql = false,
}: {
  entries: JournalEntry[];
  todayInHistory: TodayInHistoryEntry[];
  topTags: JournalTaxonomyCount[];
  topCategories: JournalTaxonomyCount[];
  categoryOptions: string[];
  tagOptions: string[];
  preferences: JournalPreferences;
  namedMappings: NamedMapping[];
  /** Only admins may run SQL; the server action re-checks this. */
  canRunSql?: boolean;
}) {
  const router = useRouter();
  const [sqlResult, setSqlResult] = useState<{ columns: string[]; rows: unknown[][] } | undefined>(undefined);
  const [sqlError, setSqlError] = useState<string | undefined>(undefined);

  function openEntry(entryId: number) {
    router.push(`/modules/journal/entries/${entryId}`);
  }

  async function handleRunSql(sql: string) {
    setSqlError(undefined);
    const result = await runJournalSqlAction(sql);
    if (!result.ok) {
      setSqlError(result.error);
      return;
    }
    setSqlResult({ columns: result.columns ?? [], rows: result.rows ?? [] });
  }

  const sqlProps = canRunSql
    ? { sql: equivalentSql(entries.length), onRunSql: handleRunSql }
    : {};

  // Columns for a re-run's arbitrary result set — derived from the returned
  // column names, since the shape is whatever the edited query produced.
  const resultColumns: DataGridColumn<SqlResultRow>[] = (sqlResult?.columns ?? []).map(
    (name, columnIndex) => ({
      key: `${name}-${columnIndex}`,
      header: name,
      value: (row) => {
        const cell = row.cells[columnIndex];
        return typeof cell === "number" ? cell : cellToText(cell);
      },
      render: (row) => cellToText(row.cells[columnIndex]),
    }),
  );

  return (
    <div className="flex flex-col gap-8">
      <CollapsibleCard title="New Journal" defaultOpen={entries.length === 0}>
        <JournalEntryForm categoryOptions={categoryOptions} tagOptions={tagOptions} preferences={preferences} />
      </CollapsibleCard>

      <div className="grid gap-8 lg:grid-cols-2">
        <CollapsibleCard title="Top Tags" defaultOpen={topTags.length > 0}>
          {topTags.length === 0 ? (
            <p className="text-sm text-muted">No tags yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {topTags.map((tag, index) => (
                <li key={tag.name} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2 text-ink">
                    <span className="w-5 text-right font-mono text-xs text-muted">{index + 1}.</span>
                    {tag.name}
                  </span>
                  <span className="rounded-full bg-brass-soft px-2 py-0.5 text-xs font-semibold text-brass-dark">
                    {tag.entryCount} {tag.entryCount === 1 ? "entry" : "entries"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CollapsibleCard>

        <CollapsibleCard title="Top Categories" defaultOpen={topCategories.length > 0}>
          {topCategories.length === 0 ? (
            <p className="text-sm text-muted">No categories yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {topCategories.map((category, index) => (
                <li key={category.name} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2 text-ink">
                    <span className="w-5 text-right font-mono text-xs text-muted">{index + 1}.</span>
                    {category.name}
                  </span>
                  <span className="rounded-full bg-brass-soft px-2 py-0.5 text-xs font-semibold text-brass-dark">
                    {category.entryCount} {category.entryCount === 1 ? "entry" : "entries"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CollapsibleCard>
      </div>

      <CollapsibleCard title="Today In History" defaultOpen={todayInHistory.length > 0}>
        <p className="mb-3 text-sm text-muted">
          {todayInHistory.length > 0
            ? `${todayInHistory.length} past ${todayInHistory.length === 1 ? "entry" : "entries"} on this month and day. Click a row to open it.`
            : "Nothing recorded on this month and day in an earlier year."}
        </p>
        <DataGrid
          columns={TODAY_IN_HISTORY_COLUMNS}
          rows={todayInHistory}
          getRowKey={(item) => item.entry.id}
          emptyMessage="No entries from earlier years on today's date."
          enableExport
          exportFileName="journal-today-in-history"
          showStatusBar={false}
          onRowClick={(item) => openEntry(item.entry.id)}
        />
      </CollapsibleCard>

      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="font-display text-xl text-ink">
              {sqlResult ? "Query result" : "Latest Entries"}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {sqlResult
                ? `${sqlResult.rows.length} row(s) returned by your query.`
                : `Showing the most recent ${entries.length} ${entries.length === 1 ? "entry" : "entries"}, newest first. Click a row to open it.`}
            </p>
          </div>
          {sqlResult && (
            <Button size="sm" variant="secondary" onClick={() => setSqlResult(undefined)}>
              Back to entries
            </Button>
          )}
        </div>

        {sqlError && <p className="mt-2 text-sm text-red-400">{sqlError}</p>}

        <div className="mt-3">
          {sqlResult ? (
            <DataGrid
              columns={resultColumns}
              rows={sqlResult.rows.map((cells, index) => ({ index, cells }))}
              getRowKey={(row) => row.index}
              emptyMessage="The query returned no rows."
              exportFileName="journal-query-result"
              {...sqlProps}
            />
          ) : (
            <DataGrid
              columns={COLUMNS}
              rows={entries}
              getRowKey={(entry) => entry.id}
              emptyMessage="No entries yet. Add one above, or import a CSV below."
              enableExport
              exportFileName="journal-entries"
              onRowClick={(entry) => openEntry(entry.id)}
              {...sqlProps}
            />
          )}
        </div>
      </section>

      <CollapsibleCard title="Import from CSV">
        <JournalImportView namedMappings={namedMappings} />
      </CollapsibleCard>
    </div>
  );
}
