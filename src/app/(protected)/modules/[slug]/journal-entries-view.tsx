"use client";

// The My Journal "Entries" browser, in two tabs:
//
//   **Main** — a saved-filter dropdown, the selected filter's criteria shown
//   back as readable text, and the matching entries below. Everything *except*
//   logged activities.
//   **Log**  — the logged activities on their own. This was its own section at
//   /modules/journal/log until the two became tabs of one screen; `JournalLogView`
//   moved here unchanged, which is why the Log tab still has its own grid,
//   bulk delete and viewer modal rather than sharing Main's.
//
// Which entries belong to which tab is decided on the server (see
// journal-entries-panel.tsx) and re-decided on every filter change by
// `findJournalEntriesAction`, not here — a client-side split could be bypassed
// by a saved filter and would disagree with the row counts.
//
// Route-local. The filter tree, its SQL compilation and its English description
// all live in src/lib/journal/filters.ts — this file only presents them.

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { SlotIcon } from "@/components/slot-icon";
import { Tabs } from "@/components/tabs";
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
import { JournalLogView } from "./journal-log-view";

// Resolved once at module scope; the registry is static, so this is not I/O.
const FILTERS_SLOT = getIconSlot("journal_card_entry_filters")!;
// Inherited from when Log was its own section. The id is persisted against any
// uploaded override, so the slot moved to the tab rather than being retired —
// see "Ids are permanent" in coding-guide.md.
const LOG_SLOT = getIconSlot("journal_section_log")!;

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
  logEntries,
  categoryIcons,
  tagIcons,
}: JournalEntriesViewProps) {
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

      <Tabs
        items={[
          {
            key: "main",
            label: "Main",
            content: (
              <MainTab
                initialEntries={initialEntries}
                initialFilters={initialFilters}
                categoryOptions={categoryOptions}
                tagOptions={tagOptions}
                initialFilterId={initialFilterId}
                appliedQuery={appliedQuery}
                queryError={queryError}
              />
            ),
          },
          {
            key: "log",
            label: (
              <span className="flex items-center gap-1.5">
                <SlotIcon slot={LOG_SLOT} className="h-4 w-4" />
                Log
              </span>
            ),
            content: (
              <JournalLogView
                entries={logEntries}
                categoryIcons={categoryIcons}
                tagIcons={tagIcons}
              />
            ),
          },
        ]}
      />
    </div>
  );
}

export interface JournalEntriesViewProps {
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
  /**
   * The Log tab's rows — every entry carrying the Log category, read whole by
   * the caller. Not filtered by the Main tab's dropdown: the Log tab is the old
   * Log section, which never had one.
   */
  logEntries: JournalEntry[];
  /** Category/tag name → icon URL, for the Log tab's viewer modal. */
  categoryIcons: Record<string, string>;
  tagIcons: Record<string, string>;
}

/**
 * The Main tab: the filter controls and the non-Log entries they narrow.
 *
 * Split out of `JournalEntriesView` when the Log tab arrived so that all the
 * filter state — selection, the builder, the applied-query banner — stays owned
 * by the tab that uses it, rather than sitting a level up where the Log tab
 * would re-render on every change it has no interest in.
 */
function MainTab({
  initialEntries,
  initialFilters,
  categoryOptions,
  tagOptions,
  initialFilterId,
  appliedQuery,
  queryError,
}: Omit<JournalEntriesViewProps, "title" | "description" | "logEntries" | "categoryIcons" | "tagIcons">) {
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
      // `false` — this tab never shows logged activities, whatever the filter
      // says. The server ANDs the condition on; see findJournalEntriesAction.
      const result = await findJournalEntriesAction(filter, false);
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
