"use client";

// The My Journal "Entries" browser, in four tabs:
//
//   **Unlocked Entries** — a saved-filter dropdown, the selected filter's
//   criteria shown back as readable text, and the matching entries below,
//   narrowed to entries that aren't locked. First because it is the everyday
//   view: the entries you can still edit.
//   **Substantial Entries** — the same screen, narrowed to entries whose body
//   runs to more than ten words. Encrypted entries never appear: a sealed body
//   can't be measured. See src/lib/journal/body-length.ts.
//   **All Entries**      — the same again with no narrowing at all. Every
//   entry, locked and logged activities included. Last of the three grids
//   because it is the widest net rather than the usual starting point, and no
//   longer the tab the screen opens on — that is Unlocked Entries, named
//   explicitly in `defaultActiveKey` rather than inherited from tab order.
//   `?tab=main` still comes straight here.
//   **Log**              — the logged activities on their own. This was its own
//   section at /modules/journal/log until they became tabs of one screen;
//   `JournalLogView` moved here unchanged, which is why the Log tab still has
//   its own grid, bulk delete and viewer modal rather than sharing the others'.
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
// everything (scope `"all"`), Unlocked is the unlocked subset of it,
// Substantial is the long-bodied subset of it, and Log is the Log-only view,
// which contains locked, unlocked, long and short entries alike.
//
// Route-local. The filter tree, its SQL compilation and its English description
// all live in src/lib/journal/filters.ts — this file only presents them.

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { BulkConfirm } from "@/components/bulk-confirm";
import { BusyOverlay } from "@/components/busy-overlay";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { EncryptionPrompt } from "@/components/encryption-prompt";
import { SlotIcon } from "@/components/slot-icon";
import { Tabs } from "@/components/tabs";
import { getIconSlot } from "@/lib/icons";
import {
  ENCRYPTED_TITLE_PLACEHOLDER,
  // The threshold is read from lib rather than written as "10" in the copy, so
  // the sentence can't drift from the condition the SQL actually applies.
  SUBSTANTIAL_MIN_WORDS,
  countBodyWords,
  describeFilter,
  displayEntryTitle,
  emptyFilter,
  type JournalBodyScope,
  type JournalEntry,
  type JournalFilter,
  type JournalLockScope,
  type SavedJournalFilter,
} from "@/lib/journal";
import {
  deleteJournalFilterAction,
  findJournalEntriesAction,
  runJournalSqlAction,
  saveJournalFilterAction,
} from "./journal-actions";
import {
  bulkEncryptJournalEntriesAction,
  bulkLockJournalEntriesAction,
  deleteJournalEntriesAction,
  type BulkRefreshScope,
} from "./journal-bulk-actions";
import { JournalEntriesBulkEdit } from "./journal-entries-bulk-edit";
import { JournalFilterBuilder } from "./journal-filter-builder";
import { JournalLogView } from "./journal-log-view";

// Resolved once at module scope; the registry is static, so this is not I/O.
const FILTERS_SLOT = getIconSlot("journal_card_entry_filters")!;
// Inherited from when Log was its own section. The id is persisted against any
// uploaded override, so the slot moved to the tab rather than being retired —
// see "Ids are permanent" in coding-guide.md.
const LOG_SLOT = getIconSlot("journal_section_log")!;
// Migration 0131. The lock badge on an encrypted row's Title cell.
const ENCRYPTED_SLOT = getIconSlot("journal_entry_encrypted")!;

const COLUMNS: DataGridColumn<JournalEntry>[] = [
  { key: "date", header: "Date", value: (entry) => entry.date, render: (entry) => entry.date },
  { key: "time", header: "Time", value: (entry) => entry.time, render: (entry) => entry.time },
  {
    key: "title",
    header: "Title",
    // An encrypted entry's title column is blank (migration 0131), so both the
    // sort value and the cell use the placeholder — otherwise every encrypted
    // row would sort together at the top under an empty string and read as a
    // set of untitled entries.
    value: (entry) => displayEntryTitle(entry.title, entry.isEncrypted),
    render: (entry) =>
      entry.isEncrypted ? (
        <span className="inline-flex items-center gap-1.5 text-muted">
          <SlotIcon slot={ENCRYPTED_SLOT} className="h-3.5 w-3.5" />
          {ENCRYPTED_TITLE_PLACEHOLDER}
        </span>
      ) : (
        entry.title
      ),
  },
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

/**
 * The Substantial Entries tab's columns: the shared set with Place swapped for
 * Body Length.
 *
 * Its own list rather than a prop on `COLUMNS`, because the two differ in what
 * they are *for*. Place is dead weight on this tab — it is the one tab defined
 * by the body, and the entries it lists are prose, not places — while the word
 * count is meaningless on the other two, where short and empty entries are
 * exactly what you are often looking for.
 *
 * `COLUMNS` is left untouched on purpose: All Entries and Unlocked Entries
 * share it, so not touching it is what makes those two provably unchanged.
 *
 * Derived from `COLUMNS` rather than retyped so the Date/Time/Title/Categories/
 * Tags definitions — including the encrypted-title placeholder — stay defined
 * once. Anything added to the shared list appears here too, which is the right
 * default: this tab wants every column the others have except Place.
 */
/** One row of a "Show SQL" re-run's arbitrary result set. */
interface SqlResultRow {
  index: number;
  cells: unknown[];
}

/** A result cell as display text. NULL and undefined both read as blank. */
function cellToText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

const SUBSTANTIAL_COLUMNS: DataGridColumn<JournalEntry>[] = [
  ...COLUMNS.filter((column) => column.key !== "place"),
  {
    key: "bodyWords",
    header: "Body Length",
    // Counted in lib by the same arithmetic the filter's SQL uses, so the number
    // in this cell can never contradict the condition that put the row here.
    // Never below SUBSTANTIAL_MIN_WORDS + 1 on this tab, by definition.
    value: (entry) => countBodyWords(entry.content),
    render: (entry) => countBodyWords(entry.content).toLocaleString(),
    // Right-aligned and tabular: a column of numbers compares down the column,
    // not across, and proportional digits make unequal numbers look equal.
    className: "text-right tabular-nums",
  },
];

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
  initialSql,
  initialUnlockedSql,
  initialSubstantialSql,
  canRunSql = false,
  initialFilters,
  categoryOptions,
  tagOptions,
  locationCategoryOptions,
  locationTagOptions,
  initialFilterId,
  appliedQuery,
  queryError,
  initialTab,
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
        // Uncontrolled still — the tab is a starting point, not state the URL
        // keeps in step. `Tabs` ignores a key it doesn't know and shows the
        // first tab, so no validation is needed on the way in.
        //
        // The screen opens on **Unlocked Entries**, the first tab — the
        // everyday view, and what `?tab=` lands on when it names nothing
        // recognised. `"unlocked"` is still written out rather than left to
        // `Tabs`' first-item fallback, so the landing tab stays a decision
        // this line makes: reordering the strip must not silently move it.
        //
        // `?tab=main` still reaches All Entries, which is why "main" is in the
        // list below even though it is no longer the default.
        defaultActiveKey={
          initialTab === "log" ||
          initialTab === "main" ||
          initialTab === "unlocked" ||
          initialTab === "substantial"
            ? initialTab
            : "unlocked"
        }
        items={[
          {
            key: "unlocked",
            label: "Unlocked Entries",
            content: (
              <EntriesTab
                // `key` is load-bearing, not decoration. `Tabs` renders only the
                // active tab's content, at one position in the tree, and all
                // three grid tabs are the same component type — so without a
                // distinct key React reconciles them as **one instance** and
                // keeps its state across a tab switch. `useState(initialEntries)`
                // then only ever runs for whichever tab mounted first, and the
                // other two render that tab's rows under their own heading.
                key="unlocked"
                lockScope="unlocked"
                bodyScope="all"
                initialEntries={initialUnlockedEntries}
                initialSql={initialUnlockedSql}
                canRunSql={canRunSql}
                initialFilters={initialFilters}
                categoryOptions={categoryOptions}
                tagOptions={tagOptions}
                locationCategoryOptions={locationCategoryOptions}
                locationTagOptions={locationTagOptions}
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
              // A third instance of the same component, with its own state —
              // again only because of the `key`. See the note on the first tab.
              <EntriesTab
                // See the note on the Unlocked Entries tab's key above.
                key="substantial"
                lockScope="all"
                bodyScope="substantial"
                initialEntries={initialSubstantialEntries}
                initialSql={initialSubstantialSql}
                canRunSql={canRunSql}
                initialFilters={initialFilters}
                categoryOptions={categoryOptions}
                tagOptions={tagOptions}
                locationCategoryOptions={locationCategoryOptions}
                locationTagOptions={locationTagOptions}
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
              // The same component again, with its own state — only because of
              // the `key`. See the note on the Unlocked Entries tab.
              <EntriesTab
                // See the note on the Unlocked Entries tab's key above.
                key="all"
                lockScope="all"
                bodyScope="all"
                initialEntries={initialEntries}
                initialSql={initialSql}
                canRunSql={canRunSql}
                initialFilters={initialFilters}
                categoryOptions={categoryOptions}
                tagOptions={tagOptions}
                locationCategoryOptions={locationCategoryOptions}
                locationTagOptions={locationTagOptions}
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
                categoryOptions={categoryOptions}
                tagOptions={tagOptions}
                locationCategoryOptions={locationCategoryOptions}
                locationTagOptions={locationTagOptions}
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
  /**
   * The statement each tab's first page came from, for the grid's "Show SQL"
   * dialog. One per tab because the three differ in exactly the conditions the
   * dialog is there to show. `undefined` for a non-admin or a failed query, and
   * the button is then absent.
   */
  initialSql?: string;
  initialUnlockedSql?: string;
  initialSubstantialSql?: string;
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
   * card's "Total Log Entries" tile is what sets "log"; `?filter=` can't reach
   * the Log tab, since it only ever narrows the three grid tabs.
   */
  initialTab?: string;
  /** Overrides for the heading above the grid, when embedded outside the section. */
  title?: string;
  description?: string;
  /**
   * The Log tab's rows — every entry carrying the Log category, read whole by
   * the caller. Not filtered by the other tabs' dropdown: the Log tab is the old
   * Log section, which never had one.
   */
  logEntries: JournalEntry[];
  /** Category/tag name → icon URL, for the Log tab's viewer modal. */
  categoryIcons: Record<string, string>;
  tagIcons: Record<string, string>;
}

/**
 * The grid tabs — All Entries, Unlocked Entries and Substantial Entries: the
 * filter controls and the entries they narrow.
 *
 * Split out of `JournalEntriesView` when the Log tab arrived so that all the
 * filter state — selection, the builder, the applied-query banner — stays owned
 * by the tab that uses it, rather than sitting a level up where the Log tab
 * would re-render on every change it has no interest in. Rendered once per grid
 * tab, so each keeps its own selection and its own ticked rows — which holds
 * **only** because each call site passes a distinct `key`. `Tabs` renders one
 * tab's content at one position, so without the key React would reuse a single
 * instance and every tab would show the first-mounted tab's rows.
 *
 * `lockScope` and `bodyScope` are the *only* differences between the three
 * instances. Both are passed to the server on every re-query and every bulk
 * refresh rather than filtering rows here — see the note at the top of the file.
 */
function EntriesTab({
  lockScope,
  bodyScope,
  initialEntries,
  initialSql,
  canRunSql = false,
  initialFilters,
  categoryOptions,
  tagOptions,
  locationCategoryOptions,
  locationTagOptions,
  initialFilterId,
  appliedQuery,
  queryError,
}: Omit<
  JournalEntriesViewProps,
  | "title"
  | "description"
  | "logEntries"
  | "categoryIcons"
  | "tagIcons"
  | "initialUnlockedEntries"
  | "initialSubstantialEntries"
  | "initialUnlockedSql"
  | "initialSubstantialSql"
> & {
  /** `"all"` for the All Entries tab, `"unlocked"` for Unlocked Entries. */
  lockScope: JournalLockScope;
  /** `"substantial"` for the Substantial Entries tab, `"all"` for the others. */
  bodyScope: JournalBodyScope;
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
  // The bulk actions on the ticked rows. `clearSelection` is handed in by
  // `DataGrid` — selection lives there, and this is the only way to drop it
  // after the rows it referred to have changed.
  const [bulkEdit, setBulkEdit] = useState<
    { rows: JournalEntry[]; clearSelection: () => void } | undefined
  >();
  const [confirmDelete, setConfirmDelete] = useState<
    { rows: JournalEntry[]; clearSelection: () => void } | undefined
  >();
  // `isLocked` is the target state, not a toggle — Lock and Unlock are two
  // buttons so a mixed selection has a defined result. See bulk-lock.ts.
  const [confirmLock, setConfirmLock] = useState<
    { rows: JournalEntry[]; clearSelection: () => void; isLocked: boolean } | undefined
  >();
  // The password is held only for the duration of the request and never stored
  // — `EncryptionPrompt` clears its own fields on submit, and nothing here
  // keeps a copy. See bulk-encrypt.ts on why there is no recovery path.
  const [confirmEncrypt, setConfirmEncrypt] = useState<
    { rows: JournalEntry[]; clearSelection: () => void } | undefined
  >();
  const [encryptError, setEncryptError] = useState<string | undefined>(undefined);
  const [isBulkBusy, setIsBulkBusy] = useState(false);
  const [notice, setNotice] = useState("");

  /**
   * The adjective this tab's copy calls its rows by — "unlocked entries",
   * "substantial entries", or plain "entries".
   *
   * One derived word rather than a boolean per scope: the count line, the
   * no-filter line, both empty states and the export filename all need the same
   * noun, and with three tabs a nested ternary in each of them is how two of
   * them end up disagreeing. `bodyScope` is checked first because only the
   * Substantial tab sets it, and it never combines with `"unlocked"`.
   */
  const rowNoun =
    bodyScope === "substantial" ? "substantial" : lockScope === "unlocked" ? "unlocked" : "";
  /** `"substantial "` / `"unlocked "` / `""` — the noun as a copy prefix. */
  const nounPrefix = rowNoun === "" ? "" : `${rowNoun} `;
  /** This tab's grid differs from the other two: its own columns and no eye. */
  const isSubstantial = bodyScope === "substantial";

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
        // `"all"` for the Log scope — every grid tab shows every entry, logged
        // activities included, so no Log condition is added. `lockScope` and
        // `bodyScope` are what separate them, and all three are applied on the
        // server; see findJournalEntriesAction.
        const result = await findJournalEntriesAction(filter, "all", lockScope, bodyScope);
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
    [lockScope, bodyScope],
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
        bodyScope === "substantial"
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

  /** Shared by both bulk actions: swap in the server's rows, say what happened. */
  function applyBulkResult(nextEntries: JournalEntry[], message: string, clearSelection: () => void) {
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
          : `${current}\n\n-- NOTE: a bulk action refreshed these rows, and the refresh could\n-- not reconstruct the ad-hoc filter above -- it re-read with NO filter.\n-- The rows on screen came from that unfiltered read, not from this.`,
      );
    }
    setNotice(message);
    setError(undefined);
    clearSelection();
    setBulkEdit(undefined);
    setConfirmDelete(undefined);
    setConfirmLock(undefined);
    setConfirmEncrypt(undefined);
    // The module's other screens (Today in History, the Calendar) read the same
    // rows, so they need re-rendering too — the action revalidated the path.
    router.refresh();
  }

  async function runBulkDelete(rows: JournalEntry[], clearSelection: () => void) {
    setIsBulkBusy(true);
    setError(undefined);
    setNotice("");
    try {
      const result = await deleteJournalEntriesAction(
        rows.map((entry) => entry.id),
        currentScope(),
      );
      if (!result.ok || !result.entries) {
        setError(result.error ?? "Failed to delete the selected entries.");
        return;
      }
      applyBulkResult(result.entries, result.message ?? "Entries deleted.", clearSelection);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to delete the selected entries.");
    } finally {
      setIsBulkBusy(false);
    }
  }

  async function runBulkLock(
    rows: JournalEntry[],
    isLocked: boolean,
    clearSelection: () => void,
  ) {
    const failed = `Failed to ${isLocked ? "lock" : "unlock"} the selected entries.`;
    setIsBulkBusy(true);
    setError(undefined);
    setNotice("");
    try {
      const result = await bulkLockJournalEntriesAction(
        rows.map((entry) => entry.id),
        isLocked,
        currentScope(),
      );
      if (!result.ok || !result.entries) {
        setError(result.error ?? failed);
        return;
      }
      applyBulkResult(result.entries, result.message ?? "Entries updated.", clearSelection);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : failed);
    } finally {
      setIsBulkBusy(false);
    }
  }

  async function runBulkEncrypt(
    rows: JournalEntry[],
    password: string,
    hint: string,
    clearSelection: () => void,
  ) {
    setIsBulkBusy(true);
    setEncryptError(undefined);
    setError(undefined);
    setNotice("");
    try {
      const result = await bulkEncryptJournalEntriesAction(
        rows.map((entry) => entry.id),
        password,
        hint,
        currentScope(),
      );
      if (!result.ok || !result.entries) {
        // Shown inside the prompt rather than as the page-level error: the
        // dialog stays open so the password can be retyped, and a message
        // behind it would be invisible.
        setEncryptError(result.error ?? "Failed to encrypt the selected entries.");
        return;
      }
      applyBulkResult(result.entries, result.message ?? "Entries encrypted.", clearSelection);
    } catch (caught) {
      setEncryptError(
        caught instanceof Error ? caught.message : "Failed to encrypt the selected entries.",
      );
    } finally {
      setIsBulkBusy(false);
    }
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
          <DataGrid
            // The Substantial tab swaps Place for Body Length; the other two keep
            // the shared set untouched.
            columns={isSubstantial ? SUBSTANTIAL_COLUMNS : COLUMNS}
            rows={entries}
            getRowKey={(entry) => entry.id}
            emptyMessage={
              selected || showAppliedQuery
                ? `No ${nounPrefix}entries match this filter.`
                : rowNoun === ""
                  ? "No entries yet."
                  : `No ${nounPrefix}entries.`
            }
            enableExport
            exportFileName={rowNoun === "" ? "journal-entries" : `journal-${rowNoun}-entries`}
            // One key for All Entries and Unlocked — same columns, same rows, so a
            // width or order set on one should hold on the other. The Substantial
            // tab gets its own: its column set differs (Place out, Body Length in),
            // and a saved order/hidden list naming columns this tab doesn't have
            // would restore a stale arrangement.
            storageKey={
              isSubstantial
                ? "myhomebase:journal-substantial-entries-grid"
                : "myhomebase:journal-entries-grid"
            }
            // No per-row record button on this tab: the row already opens on click
            // and the modal's draw is the hidden columns, which this tab doesn't
            // have. Left on elsewhere — removing it there is not what was asked.
            enableRecordView={!isSubstantial}
            onRowClick={(entry) => router.push(`/modules/journal/entries/${entry.id}`)}
            enableSelection
            renderSelectionActions={(selectedRows, clearSelection) => (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={isBulkBusy}
                  onClick={() => setBulkEdit({ rows: selectedRows, clearSelection })}
                >
                  Bulk edit
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={isBulkBusy}
                  onClick={() =>
                    setConfirmLock({ rows: selectedRows, clearSelection, isLocked: true })
                  }
                >
                  Lock
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={isBulkBusy}
                  onClick={() =>
                    setConfirmLock({ rows: selectedRows, clearSelection, isLocked: false })
                  }
                >
                  Unlock
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={isBulkBusy}
                  onClick={() => {
                    setEncryptError(undefined);
                    setConfirmEncrypt({ rows: selectedRows, clearSelection });
                  }}
                >
                  Encrypt
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={isBulkBusy}
                  onClick={() => setConfirmDelete({ rows: selectedRows, clearSelection })}
                >
                  Delete
                </Button>
              </>
            )}
            {...sqlProps}
          />
        )}
      </section>

      {bulkEdit && (
        <JournalEntriesBulkEdit
          selected={bulkEdit.rows}
          categoryOptions={categoryOptions}
          tagOptions={tagOptions}
          locationCategoryOptions={locationCategoryOptions}
          locationTagOptions={locationTagOptions}
          scope={currentScope()}
          onCancel={() => setBulkEdit(undefined)}
          onApplied={(nextEntries, message) =>
            applyBulkResult(nextEntries, message, bulkEdit.clearSelection)
          }
        />
      )}

      {confirmDelete && (
        <BulkConfirm
          title="Delete these entries?"
          description="They move to the recycle bin under Data Management, and can be restored from there."
          count={confirmDelete.rows.length}
          noun={{ one: "entry", many: "entries" }}
          caveat={
            confirmDelete.rows.some((entry) => entry.isLocked) ? (
              <>
                Some of these are <span className="text-ink">locked</span>. They move to the bin
                too, still locked — restoring one brings it back locked.
              </>
            ) : undefined
          }
          confirmLabel="Delete"
          isBusy={isBulkBusy}
          onCancel={() => setConfirmDelete(undefined)}
          onConfirm={() => void runBulkDelete(confirmDelete.rows, confirmDelete.clearSelection)}
        />
      )}

      {confirmLock && (
        <BulkConfirm
          title={confirmLock.isLocked ? "Lock these entries?" : "Unlock these entries?"}
          description={
            confirmLock.isLocked
              ? "A locked entry can't be edited or deleted on its own screen until it is unlocked."
              : "Unlocking makes these entries editable again."
          }
          count={confirmLock.rows.length}
          noun={{ one: "entry", many: "entries" }}
          caveat={(() => {
            // Only the rows that won't change are worth a caveat — saying "3 of 40
            // are already locked" is what stops the result line reading as a
            // partial failure afterwards.
            const unchanged = confirmLock.rows.filter(
              (entry) => entry.isLocked === confirmLock.isLocked,
            ).length;
            if (unchanged === 0) return undefined;
            return (
              <>
                {unchanged === 1 ? "1 is" : `${unchanged} are`} already{" "}
                {confirmLock.isLocked ? "locked" : "unlocked"} and will be left alone.
              </>
            );
          })()}
          confirmLabel={confirmLock.isLocked ? "Lock" : "Unlock"}
          tone="primary"
          isBusy={isBulkBusy}
          onCancel={() => setConfirmLock(undefined)}
          onConfirm={() =>
            void runBulkLock(
              confirmLock.rows,
              confirmLock.isLocked,
              confirmLock.clearSelection,
            )
          }
        />
      )}

      {confirmEncrypt && (
        <EncryptionPrompt
          mode="encrypt"
          asModal
          count={confirmEncrypt.rows.length}
          heading={
            confirmEncrypt.rows.length === 1
              ? "Encrypt this entry"
              : `Encrypt ${confirmEncrypt.rows.length} entries`
          }
          actionLabel="Encrypt"
          error={encryptError}
          isBusy={isBulkBusy}
          onCancel={() => {
            setConfirmEncrypt(undefined);
            setEncryptError(undefined);
          }}
          onSubmit={(password, hint) =>
            void runBulkEncrypt(
              confirmEncrypt.rows,
              password,
              hint,
              confirmEncrypt.clearSelection,
            )
          }
        />
      )}

      {/* A sibling of the dialogs above, not a child — it is z-[60] to Modal's
          z-50 so the dialog dims along with the page. Encrypting a long
          selection is the slowest write on this screen, and it is the one that
          must not be interrupted. */}
      <BusyOverlay
        isBusy={isBulkBusy && confirmEncrypt !== undefined}
        message="Encrypting…"
        detail="Don't close this window."
      />

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
