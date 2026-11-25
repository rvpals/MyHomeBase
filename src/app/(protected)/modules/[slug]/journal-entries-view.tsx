"use client";

// The My Journal "Entries" browser, in four tabs — **one component, four row
// sets**:
//
//   **Unlocked Entries** — the everyday view: the entries you can still edit.
//   First, and the tab the screen opens on — named explicitly in
//   `defaultActiveKey` rather than inherited from tab order.
//   **Substantial Entries** — the same screen, narrowed to entries whose body
//   runs to more than ten words. Encrypted entries never appear: a sealed body
//   can't be measured. See src/lib/journal/body-length.ts.
//   **All Entries** — the same again with no narrowing at all. Every entry,
//   locked and logged activities included. `?tab=main` comes straight here.
//   **Log** — the logged activities on their own.
//
// All four are the **same `EntriesTab`**, differing only in a triple of scopes
// (`lockScope` / `bodyScope` / `logScope`). That is load-bearing, not tidiness:
// it is what gives them one column set, one grid storage key, one set of bulk
// actions, one Filtering card, and one row click — which opens the full entry
// screen, the only place an entry can be edited.
//
// It was not always so. The Log tab was its own section at /modules/journal/log
// and was moved in here whole as `JournalLogView`, which left it with its own
// columns, its own storage key, bulk actions missing Lock/Unlock/Encrypt, and a
// read-only viewer modal with no way through to the editor. Three
// implementations of "a grid of journal entries" drifted apart exactly as you
// would expect them to. **If you are about to give one tab its own columns, its
// own storage key or its own action bar, that is the trap — add a scope, not a
// second component.**
//
// The grid itself is no longer here: the columns, the tick-boxes, the seven bulk
// actions and every dialog behind them live in journal-entries-grid.tsx, shared
// with Data Management → Duplicate entries. What is left in this file is the
// part that really is this screen's — the four tabs, the Filtering card, the
// "Show SQL" re-run, and which rows each tab asks the server for.
//
// Which entries belong to which tab is decided on the server (see
// journal-entries-panel.tsx), re-decided on every filter change by
// `findJournalEntriesAction`, and re-decided again after every bulk write by
// `refresh()` in journal-bulk-actions.ts — never here. A client-side `.filter()`
// would be bypassable by a saved filter and would disagree with all three. It
// would also only ever see the 500 rows already fetched, so the list would be
// the matching subset of the first 500 rather than the first 500 matching.
//
// The four overlap rather than partitioning the journal: All Entries is
// everything (log scope `"all"`), Unlocked is the unlocked subset of it,
// Substantial is the long-bodied subset of it, and Log is the Log-only view,
// which contains locked, unlocked, long and short entries alike. The saved
// filter in the Filtering card narrows all four, Log included.
//
// A fifth tab, **Search Results**, appears only with `?search=`. It is still its
// own component (`SearchTab`) because its rows come from a term rather than from
// a filter, but it renders the same `JournalEntriesGrid`, shares the same grid
// storage key and so offers the same columns and the same bulk actions.
//
// Route-local. The filter tree, its SQL compilation and its English description
// all live in src/lib/journal/filters.ts — this file only presents them.

import { useCallback, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { Comments } from "@/components/comments";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { SlotIcon } from "@/components/slot-icon";
import { Tabs } from "@/components/tabs";
import { getIconSlot } from "@/lib/icons";
import type { DashboardTextureItem } from "@/lib/dashboard-texture";
import type { JournalPreferences, JournalPrefillTemplate } from "@/lib/journal";
import {
  // The threshold is read from lib rather than written as "10" in the copy, so
  // the sentence can't drift from the condition the SQL actually applies.
  SUBSTANTIAL_MIN_WORDS,
  describeFilter,
  emptyFilter,
  type JournalBodyScope,
  type JournalEntry,
  type JournalFilter,
  type JournalLockScope,
  type JournalLogScope,
  type SavedJournalFilter,
} from "@/lib/journal";
import {
  deleteJournalFilterAction,
  findJournalEntriesAction,
  runJournalSqlAction,
  saveJournalFilterAction,
  searchJournalEntriesAction,
} from "./journal-actions";
import type { BulkRefreshScope } from "./journal-bulk-actions";
// The grid itself — columns, tick-boxes, the seven bulk actions and every dialog
// behind them, shared with Data Management → Duplicate entries. Adding a button
// or a column for one screen goes in there, not here.
import { JournalEntriesGrid } from "./journal-entries-grid";
import { JournalFilterBuilder } from "./journal-filter-builder";

// Resolved once at module scope; the registry is static, so this is not I/O.
const FILTERS_SLOT = getIconSlot("journal_card_entry_filters")!;
// Inherited from when Log was its own section. The id is persisted against any
// uploaded override, so the slot moved to the tab rather than being retired —
// see "Ids are permanent" in coding-guide.md.
const LOG_SLOT = getIconSlot("journal_section_log")!;

/** One row of a "Show SQL" re-run's arbitrary result set. */
interface SqlResultRow {
  index: number;
  cells: unknown[];
}

/** A result cell as display text. NULL and undefined both read as blank. */
function cellToText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

/** Sentinel for the dropdown's unfiltered option — "" is a real select value. */
const ALL_ENTRIES = "";

/**
 * How the Filtering card arranges its saved filters.
 *
 * `"name"` is the flat list this screen has always shown. `"category"` puts a
 * category box first and only then a filter box holding that category's filters
 * — the way to work with thirty filters split across CAR / HOUSE / KIDS.
 */
type FilterGroupMode = "name" | "category";

/**
 * The grouped mode's bucket for filters with no category (`category === ''`).
 *
 * A non-empty sentinel because "" already means "no category picked yet" in the
 * category select, and the two states have to be distinguishable: one shows an
 * empty filter box, the other shows the uncategorised filters.
 */
const UNCATEGORISED = "\u0000uncategorised";

export function JournalEntriesView({
  initialEntries,
  initialUnlockedEntries,
  initialSubstantialEntries,
  initialSearchEntries = [],
  initialSearchQuery,
  initialSql,
  initialUnlockedSql,
  initialSubstantialSql,
  initialLogSql,
  canRunSql = false,
  initialFilters,
  categoryOptions,
  tagOptions,
  locationCategoryOptions,
  locationTagOptions,
  preferences,
  contentTextures,
  prefillTemplates,
  initialFilterId,
  appliedQuery,
  queryError,
  initialTab,
  title,
  description,
  logEntries,
  clipCounts = {},
}: JournalEntriesViewProps) {
  const hasSearch = initialSearchQuery !== undefined && initialSearchQuery !== "";

  const tabs = [
    // The Search Results tab is first when present — the reader searched for
    // something, so the results are what they came for. Absent otherwise, so
    // the strip reads exactly as it did before search existed.
    ...(hasSearch
      ? [
          {
            key: "search",
            label: "Search Results",
            content: (
              <SearchTab
                key="search"
                initialEntries={initialSearchEntries}
                initialTerm={initialSearchQuery}
                clipCounts={clipCounts}
                categoryOptions={categoryOptions}
                tagOptions={tagOptions}
                locationCategoryOptions={locationCategoryOptions}
                locationTagOptions={locationTagOptions}
                preferences={preferences}
                contentTextures={contentTextures}
                prefillTemplates={prefillTemplates}
              />
            ),
          },
        ]
      : []),
    {
      key: "unlocked",
      label: "Unlocked Entries",
      content: (
        <EntriesTab
          key="unlocked"
          logScope="all"
          lockScope="unlocked"
          bodyScope="all"
          clipCounts={clipCounts}
          initialEntries={initialUnlockedEntries}
          initialSql={initialUnlockedSql}
          canRunSql={canRunSql}
          initialFilters={initialFilters}
          categoryOptions={categoryOptions}
          tagOptions={tagOptions}
          locationCategoryOptions={locationCategoryOptions}
          locationTagOptions={locationTagOptions}
          preferences={preferences}
          contentTextures={contentTextures}
          prefillTemplates={prefillTemplates}
          initialFilterId={initialFilterId}
          appliedQuery={appliedQuery}
          queryError={queryError}
        />
      ),
    },
    {
      key: "substantial",
      label: "Substantial Entries",
      content: (
        <EntriesTab
          key="substantial"
          logScope="all"
          lockScope="all"
          bodyScope="substantial"
          clipCounts={clipCounts}
          initialEntries={initialSubstantialEntries}
          initialSql={initialSubstantialSql}
          canRunSql={canRunSql}
          initialFilters={initialFilters}
          categoryOptions={categoryOptions}
          tagOptions={tagOptions}
          locationCategoryOptions={locationCategoryOptions}
          locationTagOptions={locationTagOptions}
          preferences={preferences}
          contentTextures={contentTextures}
          prefillTemplates={prefillTemplates}
          initialFilterId={initialFilterId}
          appliedQuery={appliedQuery}
          queryError={queryError}
        />
      ),
    },
    {
      key: "main",
      label: "All Entries",
      content: (
        <EntriesTab
          key="all"
          logScope="all"
          lockScope="all"
          bodyScope="all"
          clipCounts={clipCounts}
          initialEntries={initialEntries}
          initialSql={initialSql}
          canRunSql={canRunSql}
          initialFilters={initialFilters}
          categoryOptions={categoryOptions}
          tagOptions={tagOptions}
          locationCategoryOptions={locationCategoryOptions}
          locationTagOptions={locationTagOptions}
          preferences={preferences}
          contentTextures={contentTextures}
          prefillTemplates={prefillTemplates}
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
        <EntriesTab
          key="log"
          logScope="only"
          lockScope="all"
          bodyScope="all"
          clipCounts={clipCounts}
          initialEntries={logEntries}
          initialSql={initialLogSql}
          canRunSql={canRunSql}
          initialFilters={initialFilters}
          categoryOptions={categoryOptions}
          tagOptions={tagOptions}
          locationCategoryOptions={locationCategoryOptions}
          locationTagOptions={locationTagOptions}
          preferences={preferences}
          contentTextures={contentTextures}
          prefillTemplates={prefillTemplates}
          initialFilterId={initialFilterId}
          appliedQuery={appliedQuery}
          queryError={queryError}
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {(title || description) && (
        <div>
          {title && <h2 className="font-display text-xl font-semibold text-ink">{title}</h2>}
          {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        </div>
      )}

      <Tabs
        defaultActiveKey={
          initialTab === "search" && hasSearch
            ? "search"
            : initialTab === "log" ||
                initialTab === "main" ||
                initialTab === "unlocked" ||
                initialTab === "substantial"
              ? initialTab
              : "unlocked"
        }
        items={tabs}
      />
    </div>
  );
}

export interface JournalEntriesViewProps {
  /** The first page of rows, already filtered if the caller supplied a filter. */
  initialEntries: JournalEntry[];
  /**
   * The Unlocked Entries tab's first page — the same filter with the lock
   * condition added, read separately by the caller rather than derived from
   * `initialEntries`. Both lists are capped at 500 rows, so filtering the All
   * Entries page in the client would hide unlocked entries that fell outside
   * that cap.
   */
  initialUnlockedEntries: JournalEntry[];
  /**
   * The Substantial Entries tab's first page — the same filter with the
   * body-length condition added, read separately for the same reason
   * `initialUnlockedEntries` is: both lists are capped at 500 rows, so
   * narrowing the All Entries page in the client would hide substantial
   * entries that fell outside that cap.
   */
  initialSubstantialEntries: JournalEntry[];
  /** The Search Results tab's rows, from `searchEntries`. Empty when no search was asked. */
  initialSearchEntries?: JournalEntry[];
  /** The text search term that produced `initialSearchEntries`. */
  initialSearchQuery?: string;
  /**
   * The statement each tab's first page came from, for the grid's "Show SQL"
   * dialog. One per tab because the four differ in exactly the conditions the
   * dialog is there to show. `undefined` for a non-admin or a failed query, and
   * the button is then absent.
   */
  initialSql?: string;
  initialUnlockedSql?: string;
  initialSubstantialSql?: string;
  initialLogSql?: string;
  /**
   * Whether to offer "Show SQL" at all. Admins only — presentation only, since
   * `runJournalSqlAction` re-checks the role before running anything.
   */
  canRunSql?: boolean;
  initialFilters: SavedJournalFilter[];
  categoryOptions: string[];
  tagOptions: string[];
  /**
   * The saved-location library's own category/tag names, for the bulk-edit
   * dialog's location picker. Separate from the two above on purpose: a *place*
   * category ("Trailhead") and an *entry* category are unrelated rows in
   * unrelated tables.
   */
  locationCategoryOptions: string[];
  locationTagOptions: string[];
  /**
   * What the Merge bulk action's entry form needs, the same reads the New Journal
   * Entry section makes. Only the grid tabs' Merge uses them.
   */
  preferences: JournalPreferences;
  contentTextures?: DashboardTextureItem[];
  prefillTemplates: JournalPrefillTemplate[];
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
  /**
   * Which tab to open on — "log", "main", "unlocked" or "substantial";
   * everything else lands on Unlocked Entries, the first tab. The Statistics
   * card's "Total Log Entries" tile is what sets "log". `?filter=` reaches every
   * tab, Log included — all four share one Filtering card.
   */
  initialTab?: string;
  /** Overrides for the heading above the grid, when embedded outside the section. */
  title?: string;
  description?: string;
  /**
   * The Log tab's first page — the same filter with the Log condition added, a
   * read of its own for the same reason the unlocked and substantial lists are:
   * every list is capped at 500 rows, so narrowing the All Entries page in the
   * client would hide log entries that fell outside that cap.
   *
   * It used to be the whole unfiltered Log list, because the Log tab had no
   * filter controls. It has them now, like every other tab.
   */
  logEntries: JournalEntry[];
  /**
   * Entry id → how many clips are attached to it (migration 0155), for the
   * paperclip on the Title cell. An id with none is absent rather than zero, so a
   * reader of this map tests with `?? 0`.
   *
   * Optional, and defaulted to `{}`: this view is embedded in several places, and
   * one that has not been taught to count clips should render without them rather
   * than fail to compile.
   */
  clipCounts?: Record<number, number>;
}

/**
 * **Every tab on this screen** — Unlocked, Substantial, All Entries and Log: the
 * filter controls, the grid, and the bulk actions on the ticked rows.
 *
 * Split out of `JournalEntriesView` so that all the filter state — selection,
 * the builder, the applied-query banner — stays owned by the tab using it,
 * rather than sitting a level up where every tab would re-render on a change
 * only one of them cares about. Rendered once per tab, so each keeps its own
 * selection and its own ticked rows — which holds **only** because each call
 * site passes a distinct `key`. `Tabs` renders one tab's content at one
 * position, so without the key React would reuse a single instance and every
 * tab would show the first-mounted tab's rows.
 *
 * `lockScope`, `bodyScope` and `logScope` are the *only* differences between the
 * four instances. All three are passed to the server on every re-query and
 * every bulk refresh rather than filtering rows here — see the note at the top
 * of the file. Resist adding a fourth kind of difference: the reason this
 * component exists is that the Log tab once was its own, and ended up with
 * different columns, different bulk actions and no route to the editor.
 */
function EntriesTab({
  lockScope,
  bodyScope,
  logScope,
  clipCounts,
  initialEntries,
  initialSql,
  canRunSql = false,
  initialFilters,
  categoryOptions,
  tagOptions,
  locationCategoryOptions,
  locationTagOptions,
  preferences,
  contentTextures,
  prefillTemplates,
  initialFilterId,
  appliedQuery,
  queryError,
}: Omit<
  JournalEntriesViewProps,
  | "title"
  | "description"
  | "logEntries"
  | "initialUnlockedEntries"
  | "initialSubstantialEntries"
  | "initialUnlockedSql"
  | "initialSubstantialSql"
  | "initialLogSql"
> & {
  /** `"all"` for the All Entries tab, `"unlocked"` for Unlocked Entries. */
  lockScope: JournalLockScope;
  /** `"substantial"` for the Substantial Entries tab, `"all"` for the others. */
  bodyScope: JournalBodyScope;
  /** `"only"` for the Log tab, `"all"` for the other three. */
  logScope: JournalLogScope;
  /**
   * Clips attached per entry id, for the Title cell's paperclip. Absent ids have
   * none — the count query omits them rather than returning zeros.
   */
  clipCounts: Record<number, number>;
}) {
  const router = useRouter();
  const [filters, setFilters] = useState(initialFilters);
  const [selectedId, setSelectedId] = useState<string>(
    initialFilterId === undefined ? ALL_ENTRIES : String(initialFilterId),
  );
  // How the filter picker is arranged. Deliberately not persisted: it is a way of
  // *finding* a filter, not a setting, and it resets on navigation like the rest
  // of this component's state. Defaults to the flat list, so a reader who never
  // touches it sees the screen exactly as it was.
  const [groupMode, setGroupMode] = useState<FilterGroupMode>(
    // A filter arriving from a deep link is already selected; opening in grouped
    // mode would hide it behind a category box the reader never chose.
    "name",
  );
  // Which category the grouped mode is showing. "" = none picked yet, which is
  // what makes the filter select below it empty and disabled.
  const [browseCategory, setBrowseCategory] = useState("");
  const [entries, setEntries] = useState(initialEntries);
  // The statement `entries` came from. Updated in lockstep with the rows above —
  // every path that replaces one replaces the other, so the dialog can never
  // describe a query that produced some earlier list. `undefined` whenever the
  // server declined to send one (non-admin, or a filter that never compiled),
  // which is also what hides the button.
  const [sql, setSql] = useState(initialSql);
  // A re-run's own result. Arbitrary columns, so it can't feed the grid above —
  // it renders in its own grid below, the way the Journal home screen does.
  const [sqlResult, setSqlResult] = useState<
    { columns: string[]; rows: unknown[][] } | undefined
  >(undefined);
  const [sqlError, setSqlError] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(queryError);
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<SavedJournalFilter | undefined>(undefined);
  // Dropped as soon as the reader picks something else — the caller's query
  // describes the rows they were handed, not whatever is on screen now.
  const [showAppliedQuery, setShowAppliedQuery] = useState(Boolean(appliedQuery));
  const [notice, setNotice] = useState("");

  /**
   * The adjective this tab's copy calls its rows by — "log entries",
   * "unlocked entries", "substantial entries", or plain "entries".
   *
   * One derived word rather than a boolean per scope: the count line, the
   * no-filter line, both empty states and the export filename all need the same
   * noun, and with four tabs a nested ternary in each of them is how two of them
   * end up disagreeing. Each scope is tested in turn because no two of them ever
   * combine — only the Log tab sets `logScope`, only the Substantial tab sets
   * `bodyScope`, and only the Unlocked tab sets `lockScope`.
   */
  const rowNoun =
    logScope === "only"
      ? "log"
      : bodyScope === "substantial"
        ? "substantial"
        : lockScope === "unlocked"
          ? "unlocked"
          : "";
  /** `"log "` / `"substantial "` / `"unlocked "` / `""` — the copy prefix. */
  const nounPrefix = rowNoun === "" ? "" : `${rowNoun} `;

  const selected = filters.find((candidate) => String(candidate.id) === selectedId);

  /**
   * The categories in use, for the grouped mode's first box.
   *
   * Derived from `filters` rather than read from the server, so it stays correct
   * after a save or delete without another round trip — `handleSave` already
   * replaces the whole list. Case-insensitive, keeping the first spelling seen,
   * which matches how the repository groups them.
   */
  const browseCategories = useMemo(() => {
    const seen = new Map<string, string>();
    for (const filter of filters) {
      if (filter.category === "") continue;
      const key = filter.category.toLowerCase();
      if (!seen.has(key)) seen.set(key, filter.category);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [filters]);

  /** Whether any filter has no category — decides if the bucket option appears. */
  const hasUncategorised = useMemo(
    () => filters.some((filter) => filter.category === ""),
    [filters],
  );

  /** The filters in the chosen category, for the grouped mode's second box. */
  const filtersInCategory = useMemo(() => {
    if (browseCategory === "") return [];
    const matches =
      browseCategory === UNCATEGORISED
        ? filters.filter((filter) => filter.category === "")
        : filters.filter(
            (filter) => filter.category.toLowerCase() === browseCategory.toLowerCase(),
          );
    return [...matches].sort((a, b) => a.name.localeCompare(b.name));
  }, [filters, browseCategory]);

  /** The flat mode's list: every filter by name, regardless of category. */
  const filtersByName = useMemo(
    () => [...filters].sort((a, b) => a.name.localeCompare(b.name)),
    [filters],
  );

  const applyFilter = useCallback(
    async (filter: JournalFilter) => {
      setIsLoading(true);
      setError(undefined);
      try {
        // All three scopes go to the server rather than being applied to the
        // rows here. `logScope` is `"only"` on the Log tab and `"all"` on the
        // other three — they show every entry, logged activities included, and
        // `lockScope`/`bodyScope` are what separate those. See
        // findJournalEntriesAction.
        const result = await findJournalEntriesAction(filter, logScope, lockScope, bodyScope);
        if (!result.ok) {
          setError(result.error);
          // The rows on screen are still the previous filter's, so the stored
          // statement still describes them correctly and is left alone. What it
          // must not claim is that it produced *this* attempt's result, so the
          // failure is appended for whoever opens the dialog to debug it.
          setSql((current) =>
            current === undefined
              ? current
              : `${current}\n\n-- NOTE: the last filter failed to apply and these rows are\n-- the PREVIOUS filter's. Server said: ${result.error ?? "unknown error"}`,
          );
          return;
        }
        setEntries(result.entries ?? []);
        // Replaced together with the rows, never independently.
        setSql(result.sql);
      } finally {
        setIsLoading(false);
      }
    },
    [logScope, lockScope, bodyScope],
  );

  // Changing the dropdown is an event, not external state to synchronize, so the
  // re-query happens here rather than in an effect keyed on the selection. The
  // first render needs no query at all — the server handed us the unfiltered list.
  function handleSelect(value: string) {
    setSelectedId(value);
    setShowAppliedQuery(false);
    const next = filters.find((candidate) => String(candidate.id) === value);
    void applyFilter(next?.filter ?? emptyFilter());
  }

  async function handleSave(
    name: string,
    filter: JournalFilter,
    category: string,
    description: string,
  ) {
    const result = await saveJournalFilterAction(name, filter, category, description);
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

  /**
   * The filter the grid currently reflects, plus which tab is asking, so a bulk
   * action can re-query the same rows — the lock and body-length conditions are
   * re-applied there, which is what makes a row leave the Unlocked tab when it
   * is locked from it, and leave the Substantial tab when an edit trims its body
   * below the word count.
   *
   * An ad-hoc `appliedQuery` isn't reconstructable here — only its
   * text was passed down, not its parsed tree — so that case falls back to the
   * unfiltered list rather than guessing. The rows a reader then sees are a
   * superset of what they had, which is the safe direction to be wrong in.
   */
  function currentScope(): BulkRefreshScope {
    return {
      tab:
        logScope === "only"
          ? "log"
          : bodyScope === "substantial"
            ? "substantial"
            : lockScope === "unlocked"
              ? "unlocked"
              : "main",
      filter: selected?.filter ?? emptyFilter(),
    };
  }

  /**
   * Runs an edited query from the "Show SQL" dialog.
   *
   * The result has arbitrary columns, so it cannot feed the grid above — it
   * replaces it, with a "Back to entries" button, exactly as the Journal home
   * screen does. The role is re-checked server-side; `canRunSql` only decides
   * whether the button is drawn.
   */
  async function handleRunSql(nextSql: string) {
    setSqlError(undefined);
    const result = await runJournalSqlAction(nextSql);
    if (!result.ok) {
      setSqlError(result.error);
      return;
    }
    setSqlResult({ columns: result.columns ?? [], rows: result.rows ?? [] });
  }

  // Both or neither: DataGrid only draws the button when `onRunSql` is present,
  // and a statement the server declined to send means there is nothing to show.
  const sqlProps = canRunSql && sql ? { sql, onRunSql: handleRunSql } : {};

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

  /**
   * The grid's `onRowsChanged`: swap in the server's rows and say what happened.
   *
   * Only this tab's own concerns are here. Clearing the ticks, closing the
   * dialogs and re-rendering the rest of the module all happen inside
   * `JournalEntriesGrid`, which is the thing that knows a write just landed.
   */
  function applyBulkResult(nextEntries: JournalEntry[], message: string) {
    setEntries(nextEntries);
    // The refresh re-runs `currentScope()`, which is the *selected saved filter*
    // — so for an ad-hoc `appliedQuery` (which currentScope can't reconstruct,
    // see its note) these rows came from the unfiltered fallback, not from the
    // statement on display. Said so in the statement rather than hiding the
    // button: the dialog is a debugging tool, and a query with a note attached
    // is more use than no query at all. Picking a filter re-queries and
    // replaces this wholesale.
    if (showAppliedQuery) {
      setSql((current) =>
        current === undefined
          ? current
          : `${current}

-- NOTE: a bulk action refreshed these rows, and the refresh could
-- not reconstruct the ad-hoc filter above -- it re-read with NO filter.
-- The rows on screen came from that unfiltered read, not from this.`,
      );
    }
    setNotice(message);
    setError(undefined);
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
      {/* Every filter control lives in here — the saved-filter dropdown, the
          New/Edit/Delete buttons and the readout of what the selection actually
          means. They were three separate blocks stacked above the grid; one card
          keeps them together and lets the reader fold the whole apparatus away
          once they have the list they wanted.

          Uncontrolled, so the card remembers per route whether the reader left
          it open (see CollapsibleCard). `defaultOpen` only decides the first
          visit: a filter arriving from a deep link opens it, because the rows on
          screen are narrowed and the reason should be visible. */}
      <CollapsibleCard
        title="Filtering"
        titleIcon={<SlotIcon slot={FILTERS_SLOT} className="h-4 w-4" />}
        defaultOpen={Boolean(selected) || showAppliedQuery}
      >
        <div className="flex flex-col gap-4">
          {/* How to find a filter, above the picker it rearranges. Only shown once
              at least one filter carries a category — until then the grouped mode
              has nothing to group and the control would be a dead choice. */}
          {(browseCategories.length > 0 || groupMode === "category") && (
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-ink">Show filters by:</span>
              <select
                value={groupMode}
                onChange={(event) => {
                  setGroupMode(event.target.value as FilterGroupMode);
                  // Switching back to the flat list drops the category, so
                  // returning to grouped mode starts from "pick a category"
                  // rather than from a stale one. The *selected filter* is left
                  // alone — the rows on screen must not change because the reader
                  // changed how the list is arranged.
                  setBrowseCategory("");
                }}
                className="w-64 rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass max-lg:w-full"
              >
                <option value="name">by Filter name</option>
                <option value="category">by category first</option>
              </select>
            </label>
          )}

          <div className="flex flex-wrap items-end gap-3">
            {groupMode === "category" ? (
              <>
                <label className="min-w-0 text-sm">
                  <span className="mb-1 block font-medium text-ink">Category</span>
                  <select
                    value={browseCategory}
                    onChange={(event) => setBrowseCategory(event.target.value)}
                    className="w-64 rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass max-lg:w-full"
                  >
                    {/* Seeded as the rendered value, so the select never shows an
                        option that isn't its own state. */}
                    <option value="">Select a category…</option>
                    {browseCategories.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                    {/* Last, and only when there is something in it. */}
                    {hasUncategorised && <option value={UNCATEGORISED}>Uncategorised</option>}
                  </select>
                </label>

                <label className="min-w-0 text-sm">
                  <span className="mb-1 block font-medium text-ink">Filter</span>
                  <select
                    // `selectedId` only if that filter is in the chosen category.
                    // A select whose value matches no option renders as its first
                    // one, so a filter selected elsewhere (a deep link, or the
                    // flat list before the reader switched) would silently display
                    // as "All entries" while the grid still showed its rows. The
                    // selection itself is untouched — only what this box displays.
                    value={
                      filtersInCategory.some((filter) => String(filter.id) === selectedId)
                        ? selectedId
                        : ALL_ENTRIES
                    }
                    disabled={browseCategory === ""}
                    onChange={(event) => handleSelect(event.target.value)}
                    className="w-64 rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass disabled:opacity-50 max-lg:w-full"
                  >
                    <option value={ALL_ENTRIES}>
                      {browseCategory === "" ? "Select a category first" : "All entries"}
                    </option>
                    {filtersInCategory.map((filter) => (
                      <option key={filter.id} value={String(filter.id)}>
                        {filter.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <label className="min-w-0 text-sm">
                <span className="mb-1 block font-medium text-ink">Filter</span>
                <select
                  value={selectedId}
                  onChange={(event) => handleSelect(event.target.value)}
                  className="w-64 rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass max-lg:w-full"
                >
                  <option value={ALL_ENTRIES}>All entries</option>
                  {filtersByName.map((filter) => (
                    <option key={filter.id} value={String(filter.id)}>
                      {filter.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

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

          {/* What the current selection means, in words. Was its own "Filter
              conditions" card directly below the controls; now the lower half of
              this one, separated by a rule rather than a card edge. */}
          <div className="border-t border-line pt-4">
            {selected ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-ink">{describeFilter(selected.filter)}</p>
                {/* The reader's own words. The criteria line above is generated
                    from the conditions and says what the filter matches; this
                    says why it exists, which nothing can derive. */}
                {selected.description !== "" && (
                  <p className="text-sm text-muted">{selected.description}</p>
                )}
                <p className="text-xs text-muted">
                  Saved as &ldquo;{selected.name}&rdquo;
                  {selected.category !== "" && ` · ${selected.category}`} · last updated{" "}
                  {selected.updatedAt}
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
                No filter selected —{" "}
                {`every ${nounPrefix}entry is listed`}. Pick a saved filter above, or create one.
              </p>
            )}
          </div>
        </div>
      </CollapsibleCard>

      {/* Outside the card deliberately: an error from a filter that failed to
          apply, or the result line from a bulk action, must stay visible when
          the card is collapsed. */}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {notice && <p className="text-sm text-muted">{notice}</p>}

      <section>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
            {isLoading ? (
              "Applying filter…"
            ) : sqlResult ? (
              // A re-run is showing: the entry count below would describe rows
              // that are no longer on screen.
              `${sqlResult.rows.length} row(s) returned by your query.`
            ) : (
              <>
                <span className="rounded-full bg-brass-soft px-2 py-0.5 text-xs font-semibold text-brass-dark tabular-nums">
                  {entries.length}
                </span>
                <span>
                  {`${nounPrefix}${entries.length === 1 ? "entry" : "entries"}${
                    selected
                      ? ` matching "${selected.name}"`
                      : showAppliedQuery
                        ? " matching the applied filter"
                        : ""
                  }. Click a row to open it.`}
                </span>
              </>
            )}
          </p>
          {/* Only while a re-run is showing — the way back to the entries this
              tab is actually for. */}
          {sqlResult && (
            <Button size="sm" variant="secondary" onClick={() => setSqlResult(undefined)}>
              Back to entries
            </Button>
          )}
        </div>
        {sqlError && <p className="mb-2 text-sm text-red-400">{sqlError}</p>}
        {/* What "substantial" means, on the one tab where the word is doing the
            narrowing. Outside the Filtering card deliberately: the card folds
            away, and this explains the rows rather than the filter — a reader
            who collapsed the filters still needs to know why short entries are
            missing. Mentions the encrypted exclusion because that one is
            otherwise invisible: a sealed entry simply isn't there, with nothing
            on screen to say it was considered. */}
        {bodyScope === "substantial" && (
          <p className="mb-3 text-xs text-muted">
            Entries whose body runs to more than {SUBSTANTIAL_MIN_WORDS} words. Encrypted
            entries are never listed here — a sealed body can&rsquo;t be measured.
          </p>
        )}
        {/* What the Log tab is, kept from the section it used to be. Like the
            line above, this explains the *rows*; the grid below is the same grid
            every other tab draws. */}
        {logScope === "only" && (
          <div className="mb-3 flex items-start justify-between gap-3">
            <p className="text-xs text-muted">
              Everything carrying the <span className="text-ink">Log</span> category — logged
              activities rather than written entries, including everything Calendar Import
              created. These are kept out of the home screen&rsquo;s Today in History card;
              they still appear in All Entries, Calendar and search.
            </p>
            <Comments
              title="About"
              content={
                "A log entry is a short record of something that happened — a practice, a lesson, " +
                "an appointment — rather than something you sat down to write. Anything the " +
                "Calendar Import creates lands here, and you can add one by hand by giving a new " +
                "entry the Log category.\n\n" +
                "Click a row to open it on its own screen, where it can be edited. Deleting " +
                "moves entries to the recycle bin under Data Management, so a mis-ticked row " +
                "is recoverable."
              }
            />
          </div>
        )}
        {/* A re-run's result replaces the entries grid rather than sitting beside
            it: its columns are whatever the edited query returned, so none of
            this tab's row actions (open, bulk edit, lock) mean anything against
            them. "Back to entries" above restores the grid. */}
        {sqlResult ? (
          <DataGrid
            columns={resultColumns}
            rows={sqlResult.rows.map((cells, index) => ({ index, cells }))}
            getRowKey={(row) => row.index}
            emptyMessage="The query returned no rows."
            enableExport
            exportFileName="journal-query-result"
            {...sqlProps}
          />
        ) : (
          <JournalEntriesGrid
            rows={entries}
            scope={currentScope}
            onRowsChanged={applyBulkResult}
            onError={setError}
            onNotice={setNotice}
            clipCounts={clipCounts}
            onRowClick={(entry) => router.push(`/modules/journal/entries/${entry.id}`)}
            emptyMessage={
              selected || showAppliedQuery
                ? `No ${nounPrefix}entries match this filter.`
                : rowNoun === ""
                  ? "No entries yet."
                  : `No ${nounPrefix}entries.`
            }
            exportFileName={rowNoun === "" ? "journal-entries" : `journal-${rowNoun}-entries`}
            // One key for every tab, and for Search Results: same columns, same
            // rows, so a width, an order or a hidden column set on one holds on all
            // of them. Three keys is what let the tabs look like three screens.
            storageKey="myhomebase:journal-entries-grid"
            formOptions={{
              categoryOptions,
              tagOptions,
              locationCategoryOptions,
              locationTagOptions,
              preferences,
              contentTextures,
              prefillTemplates,
            }}
            {...sqlProps}
          />
        )}
      </section>

      {isBuilderOpen && (
        <JournalFilterBuilder
          existing={editing}
          categoryOptions={categoryOptions}
          tagOptions={tagOptions}
          // The same derived list the grouped mode's category box uses, rather
          // than a prop threaded down from the server: it is computed from
          // `filters`, which `handleSave` already replaces, so a category
          // invented in this dialog is suggested the next time it opens with no
          // round trip.
          filterCategoryOptions={browseCategories}
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

// ---------------------------------------------------------------------------
// Search Results tab
// ---------------------------------------------------------------------------

const SEARCH_INPUT_CLASS =
  "min-w-0 flex-1 rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

function SearchTab({
  initialEntries,
  initialTerm,
  clipCounts,
  categoryOptions,
  tagOptions,
  locationCategoryOptions,
  locationTagOptions,
  preferences,
  contentTextures,
  prefillTemplates,
}: {
  initialEntries: JournalEntry[];
  initialTerm: string;
  clipCounts: Record<number, number>;
  categoryOptions: string[];
  tagOptions: string[];
  locationCategoryOptions: string[];
  locationTagOptions: string[];
  preferences: JournalPreferences;
  contentTextures?: DashboardTextureItem[];
  prefillTemplates: JournalPrefillTemplate[];
}) {
  const router = useRouter();
  const [entries, setEntries] = useState(initialEntries);
  const [term, setTerm] = useState(initialTerm);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState("");

  function currentScope(): BulkRefreshScope {
    return { tab: "search", term };
  }

  /** The grid's `onRowsChanged`. Everything else a write implies is the grid's. */
  function applyBulkResult(nextEntries: JournalEntry[], message: string) {
    setEntries(nextEntries);
    setNotice(message);
    setError(undefined);
  }

  async function handleSearch(event: FormEvent) {
    event.preventDefault();
    const query = term.trim();
    if (query === "") return;
    setIsSearching(true);
    setError(undefined);
    setNotice("");
    try {
      const result = await searchJournalEntriesAction(query);
      if (!result.ok) {
        setError(result.error ?? "Search failed.");
        return;
      }
      setEntries(result.entries ?? []);
    } finally {
      setIsSearching(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleSearch} className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search titles, content, categories, tags, or places…"
          aria-label="Search journal entries"
          className={SEARCH_INPUT_CLASS}
        />
        <Button type="submit" disabled={isSearching || term.trim() === ""}>
          {isSearching ? "Searching…" : "Search"}
        </Button>
      </form>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {notice && <p className="text-sm text-muted">{notice}</p>}

      <section>
        <p className="mb-3 text-sm text-muted">
          {isSearching ? (
            "Searching…"
          ) : (
            <>
              <span className="rounded-full bg-brass-soft px-2 py-0.5 text-xs font-semibold text-brass-dark tabular-nums">
                {entries.length}
              </span>{" "}
              {entries.length === 1 ? "entry" : "entries"} matching &ldquo;{term.trim()}&rdquo;.
              Click a row to open it.
            </>
          )}
        </p>
        <JournalEntriesGrid
          rows={entries}
          scope={currentScope}
          onRowsChanged={applyBulkResult}
          onError={setError}
          onNotice={setNotice}
          clipCounts={clipCounts}
          onRowClick={(entry) => router.push(`/modules/journal/entries/${entry.id}`)}
          emptyMessage={`No entries match "${term.trim()}".`}
          exportFileName="journal-search-entries"
          // The same key as the four tabs: same columns, same rows.
          storageKey="myhomebase:journal-entries-grid"
          formOptions={{
            categoryOptions,
            tagOptions,
            locationCategoryOptions,
            locationTagOptions,
            preferences,
            contentTextures,
            prefillTemplates,
          }}
        />
      </section>
    </div>
  );
}
