"use client";

import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import type { NamedMapping } from "@/lib/csv-import";
import type { JournalEntry } from "@/lib/journal";
import { JournalImportView } from "./journal-import-view";

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

export function JournalView({
  entries,
  namedMappings,
}: {
  entries: JournalEntry[];
  namedMappings: NamedMapping[];
}) {
  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="font-display text-xl text-ink">Entries</h2>
        <p className="mt-1 text-sm text-muted">
          {entries.length} {entries.length === 1 ? "entry" : "entries"}.
        </p>
        <div className="mt-3">
          <DataGrid
            columns={COLUMNS}
            rows={entries}
            getRowKey={(entry) => entry.id}
            emptyMessage="No entries yet. Import a CSV below to get started."
            enableExport
            exportFileName="journal-entries"
          />
        </div>
      </section>

      <CollapsibleCard title="Import from CSV" defaultOpen={entries.length === 0}>
        <JournalImportView namedMappings={namedMappings} />
      </CollapsibleCard>
    </div>
  );
}
