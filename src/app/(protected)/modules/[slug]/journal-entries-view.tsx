"use client";

// The My Journal "Entries" browser: a saved-filter dropdown, the selected
// filter's criteria shown back as readable text, and the matching entries below.
//
// Route-local. The filter tree, its SQL compilation and its English description
// all live in src/lib/journal/filters.ts — this file only presents them.

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { SlotIcon } from "@/components/slot-icon";
import { getIconSlot } from "@/lib/icons";
import {
  describeFilter,
  emptyFilter,
  type JournalEntry,
  type JournalFilter,
  type SavedJournalFilter,
} from "@/lib/journal";
import {
  deleteJournalFilterAction,
  findJournalEntriesAction,
  saveJournalFilterAction,
} from "./journal-actions";
import { JournalFilterBuilder } from "./journal-filter-builder";

// Resolved once at module scope; the registry is static, so this is not I/O.
const FILTERS_SLOT = getIconSlot("journal_card_entry_filters")!;

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
];

/** Sentinel for the dropdown's unfiltered option — "" is a real select value. */
const ALL_ENTRIES = "";

export function JournalEntriesView({
  initialEntries,
  initialFilters,
  categoryOptions,
  tagOptions,
  initialFilterId,
  appliedQuery,
  queryError,
  title,
  description,
}: {
  /** The first page of rows, already filtered if the caller supplied a filter. */
  initialEntries: JournalEntry[];
  initialFilters: SavedJournalFilter[];
  categoryOptions: string[];
  tagOptions: string[];
  /**
   * A saved filter to start on, resolved by the caller (looking a name up needs a
   * DB read, which a client component can't do). Pre-selected but **not** locked:
   * the dropdown stays live so the reader can switch away.
   */
  initialFilterId?: number;
  /**
   * An ad-hoc `filterQuery` the caller applied, kept for display only — the rows
   * already reflect it. Shown in the conditions card so an unnamed filter isn't
   * invisible.
   */
  appliedQuery?: { text: string; description: string };
  /** Why a supplied filterName/filterQuery couldn't be used. */
  queryError?: string;
  /** Overrides for the heading above the grid, when embedded outside the section. */
  title?: string;
  description?: string;
}) {
  const router = useRouter();
  const [filters, setFilters] = useState(initialFilters);
  const [selectedId, setSelectedId] = useState<string>(
    initialFilterId === undefined ? ALL_ENTRIES : String(initialFilterId),
  );
  const [entries, setEntries] = useState(initialEntries);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(queryError);
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<SavedJournalFilter | undefined>(undefined);
  // Dropped as soon as the reader picks something else — the caller's query
  // describes the rows they were handed, not whatever is on screen now.
  const [showAppliedQuery, setShowAppliedQuery] = useState(Boolean(appliedQuery));

  const selected = filters.find((candidate) => String(candidate.id) === selectedId);

  const applyFilter = useCallback(async (filter: JournalFilter) => {
    setIsLoading(true);
    setError(undefined);
    try {
      const result = await findJournalEntriesAction(filter);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEntries(result.entries ?? []);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Changing the dropdown is an event, not external state to synchronize, so the
  // re-query happens here rather than in an effect keyed on the selection. The
  // first render needs no query at all — the server handed us the unfiltered list.
  function handleSelect(value: string) {
    setSelectedId(value);
    setShowAppliedQuery(false);
    const next = filters.find((candidate) => String(candidate.id) === value);
    void applyFilter(next?.filter ?? emptyFilter());
  }

  async function handleSave(name: string, filter: JournalFilter) {
    const result = await saveJournalFilterAction(name, filter);
    if (!result.ok) throw new Error(result.error ?? "Failed to save the filter.");
    const next = result.filters ?? [];
    setFilters(next);
    // Select what was just saved, so its results are what you see.
    const saved = next.find((candidate) => candidate.name === name);
    if (saved) {
      setSelectedId(String(saved.id));
      await applyFilter(saved.filter);
    }
    setIsBuilderOpen(false);
    setEditing(undefined);
  }

  async function handleDelete(filter: SavedJournalFilter) {
    if (!window.confirm(`Delete the filter "${filter.name}"? Entries are not affected.`)) return;
    const result = await deleteJournalFilterAction(filter.id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setFilters(result.filters ?? []);
    // The selected filter is gone, so fall back to showing everything.
    setSelectedId(ALL_ENTRIES);
    await applyFilter(emptyFilter());
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Only rendered when embedded somewhere that isn't the section (the
          section supplies its own heading). */}
      {(title || description) && (
        <div>
          {title && <h2 className="font-display text-xl font-semibold text-ink">{title}</h2>}
          {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 text-sm">
          <span className="mb-1 block font-medium text-ink">Filter</span>
          <select
            value={selectedId}
            onChange={(event) => handleSelect(event.target.value)}
            className="w-64 rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass max-lg:w-full"
          >
            <option value={ALL_ENTRIES}>All entries</option>
            {filters.map((filter) => (
              <option key={filter.id} value={String(filter.id)}>
                {filter.name}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => {
              setEditing(undefined);
              setIsBuilderOpen(true);
            }}
          >
            New filter
          </Button>
          {selected && (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setEditing(selected);
                  setIsBuilderOpen(true);
                }}
              >
                Edit
              </Button>
              <Button size="sm" variant="danger" onClick={() => handleDelete(selected)}>
                Delete
              </Button>
            </>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <CollapsibleCard
        title="Filter conditions"
        titleIcon={<SlotIcon slot={FILTERS_SLOT} className="h-4 w-4" />}
        defaultOpen={Boolean(selected) || showAppliedQuery}
      >
        {selected ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-ink">{describeFilter(selected.filter)}</p>
            <p className="text-xs text-muted">
              Saved as &ldquo;{selected.name}&rdquo; · last updated {selected.updatedAt}
            </p>
          </div>
        ) : showAppliedQuery && appliedQuery ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-ink">{appliedQuery.description}</p>
            <p className="font-mono text-xs text-muted">{appliedQuery.text}</p>
            <p className="text-xs text-muted">
              Applied by the screen, not saved. Pick a saved filter above to replace it.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted">
            No filter selected — every entry is listed. Pick a saved filter above, or create one.
          </p>
        )}
      </CollapsibleCard>

      <section>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm text-muted">
            {isLoading
              ? "Applying filter…"
              : `${entries.length} ${entries.length === 1 ? "entry" : "entries"}${
                  selected
                    ? ` matching "${selected.name}"`
                    : showAppliedQuery
                      ? " matching the applied filter"
                      : ""
                }. Click a row to open it.`}
          </p>
        </div>
        <DataGrid
          columns={COLUMNS}
          rows={entries}
          getRowKey={(entry) => entry.id}
          emptyMessage={
            selected || showAppliedQuery ? "No entries match this filter." : "No entries yet."
          }
          enableExport
          exportFileName="journal-entries"
          storageKey="myhomebase:journal-entries-grid"
          onRowClick={(entry) => router.push(`/modules/journal/entries/${entry.id}`)}
        />
      </section>

      {isBuilderOpen && (
        <JournalFilterBuilder
          existing={editing}
          categoryOptions={categoryOptions}
          tagOptions={tagOptions}
          onClose={() => {
            setIsBuilderOpen(false);
            setEditing(undefined);
          }}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
