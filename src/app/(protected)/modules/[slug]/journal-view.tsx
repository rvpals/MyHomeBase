"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { SlotIcon } from "@/components/slot-icon";
import { getIconSlot } from "@/lib/icons";
import type {
  JournalEntry,
  JournalPreferences,
  JournalPrefillTemplate,
  JournalTaxonomyCount,
} from "@/lib/journal";
import { journalEntriesFilterHref, TaxonomyIconThumbnail } from "./journal-shared";
import { JournalEntryForm } from "./journal-entry-form";
import { useJournalNewEntry } from "./journal-new-entry-context";

// Resolved once at module scope — `getIconSlot` reads the static registry, no I/O. The
// non-null assertions are safe because slots.test.ts asserts each id is registered.
const STATS_SLOT = getIconSlot("journal_card_statistics")!;
const TOP_TAGS_SLOT = getIconSlot("journal_heading_top_tags")!;
const TOP_CATEGORIES_SLOT = getIconSlot("journal_heading_top_categories")!;
const RECENT_SLOT = getIconSlot("journal_card_recent_entries")!;
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

// One ranked taxonomy list inside the Statistics card. Local to this view —
// Top Tags and Top Categories are the only two, and they differ only in their
// heading, glyph and the filter link each row points at.
function TaxonomyList({
  heading,
  icon,
  counts,
  emptyMessage,
  hrefFor,
  titleFor,
  iconUrls,
}: {
  heading: string;
  icon: ReactNode;
  counts: JournalTaxonomyCount[];
  emptyMessage: string;
  hrefFor: (name: string) => string;
  titleFor: (name: string) => string;
  /** Name -> uploaded icon URL. Names without an icon are simply absent. */
  iconUrls: Record<string, string>;
}) {
  return (
    <section>
      <h3 className="flex items-center gap-2 font-display text-sm text-brass-dark">
        <span className="shrink-0">{icon}</span>
        {heading}
      </h3>
      {counts.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{emptyMessage}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {counts.map((count, index) => (
            <li key={count.name} className="flex items-center gap-2 text-sm">
              <span className="w-5 shrink-0 text-right font-mono text-xs text-muted">
                {index + 1}.
              </span>
              {/* The uploaded icon, if this tag/category has one. Rows without
                  one still reserve the width, so the names stay in one column. */}
              {iconUrls[count.name] ? (
                <TaxonomyIconThumbnail name={count.name} url={iconUrls[count.name]} />
              ) : (
                <span aria-hidden="true" className="h-5 w-5 shrink-0" />
              )}
              {/* A real Link, so middle-click and ⌘-click open the filtered
                  list in a new tab like any other navigation. */}
              <Link
                href={hrefFor(count.name)}
                title={titleFor(count.name)}
                className="min-w-0 truncate text-ink hover:text-brass-dark hover:underline"
              >
                {count.name}
              </Link>
              {/* The count sits right beside the name rather than at the far
                  edge — a fixed-size circle, so a 4-digit total doesn't stretch
                  into a pill and break the column of dots. */}
              <span
                title={`${count.entryCount} ${count.entryCount === 1 ? "entry" : "entries"}`}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brass-soft font-mono text-[0.625rem] font-semibold leading-none text-brass-dark"
              >
                {count.entryCount}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function cellToText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

export function JournalView({
  entries,
  topTags,
  topCategories,
  categoryOptions,
  tagOptions,
  categoryIcons = {},
  tagIcons = {},
  preferences,
  prefillTemplates = [],
  canRunSql = false,
}: {
  entries: JournalEntry[];
  topTags: JournalTaxonomyCount[];
  topCategories: JournalTaxonomyCount[];
  categoryOptions: string[];
  tagOptions: string[];
  /** Name -> icon URL for the Statistics lists; absent names just show no icon. */
  categoryIcons?: Record<string, string>;
  tagIcons?: Record<string, string>;
  preferences: JournalPreferences;
  /** Enabled prefill templates, for the entry form's picker. */
  prefillTemplates?: JournalPrefillTemplate[];
  /** Only admins may run SQL; the server action re-checks this. */
  canRunSql?: boolean;
}) {
  const router = useRouter();
  // Owned by the title row's New Entry button, which lives in JournalHomeHeader.
  const { isOpen: isNewEntryOpen } = useJournalNewEntry();
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
      {/* Hidden until the title row's New Entry button asks for it. Opened
          that way it starts expanded — the reader just pressed the button that
          means "write one", so a collapsed card would need a second click. */}
      {isNewEntryOpen && (
        <CollapsibleCard title="New Journal" defaultOpen className="paper-texture">
          <JournalEntryForm
            categoryOptions={categoryOptions}
            tagOptions={tagOptions}
            preferences={preferences}
            prefillTemplates={prefillTemplates}
          />
        </CollapsibleCard>
      )}

      <CollapsibleCard
        title="Statistics"
        titleIcon={<SlotIcon slot={STATS_SLOT} className="h-4 w-4" />}
        defaultOpen={topTags.length > 0 || topCategories.length > 0}
      >
        {/* Two lists side by side on a wide screen, stacked below lg. */}
        <div className="grid gap-8 lg:grid-cols-2">
          <TaxonomyList
            heading="Top Tags"
            icon={<SlotIcon slot={TOP_TAGS_SLOT} className="h-4 w-4" />}
            counts={topTags}
            emptyMessage="No tags yet."
            hrefFor={(name) => journalEntriesFilterHref("tag", name)}
            titleFor={(name) => `Show entries tagged "${name}"`}
            iconUrls={tagIcons}
          />
          <TaxonomyList
            heading="Top Categories"
            icon={<SlotIcon slot={TOP_CATEGORIES_SLOT} className="h-4 w-4" />}
            counts={topCategories}
            emptyMessage="No categories yet."
            hrefFor={(name) => journalEntriesFilterHref("category", name)}
            titleFor={(name) => `Show entries in "${name}"`}
            iconUrls={categoryIcons}
          />
        </div>
      </CollapsibleCard>

      {/* The latest-entries grid and its "Show SQL" re-run live in a card of
          their own, so the home screen is a column of collapsibles rather than
          one card plus a loose section. Starts expanded — it's the thing most
          visits to the home screen are here for. The card keeps its "Recent
          entries" title even while a re-run's result is showing; the body says
          which of the two you're looking at. */}
      <CollapsibleCard
        title="Recent entries"
        titleIcon={<SlotIcon slot={RECENT_SLOT} className="h-4 w-4" />}
        defaultOpen
        headerAction={
          sqlResult ? (
            <Button size="sm" variant="secondary" onClick={() => setSqlResult(undefined)}>
              Back to entries
            </Button>
          ) : undefined
        }
      >
        <p className="text-sm text-muted">
          {sqlResult
            ? `${sqlResult.rows.length} row(s) returned by your query.`
            : `Showing the most recent ${entries.length} ${entries.length === 1 ? "entry" : "entries"}, newest first. Click a row to open it.`}
        </p>

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
      </CollapsibleCard>
    </div>
  );
}
