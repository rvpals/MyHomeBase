"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { RankBar } from "@/components/rank-bar";
import { SlotIcon } from "@/components/slot-icon";
import { getIconSlot } from "@/lib/icons";
import type {
  JournalEntry,
  JournalEntryTally,
  JournalTaxonomyCount,
  JournalWordCount,
  JournalYearCount,
} from "@/lib/journal";
import { journalEntriesFilterHref, TaxonomyIconThumbnail } from "./journal-shared";

// Resolved once at module scope — `getIconSlot` reads the static registry, no I/O. The
// non-null assertions are safe because slots.test.ts asserts each id is registered.
const STATS_SLOT = getIconSlot("journal_card_statistics")!;
const TOP_TAGS_SLOT = getIconSlot("journal_heading_top_tags")!;
const TOP_CATEGORIES_SLOT = getIconSlot("journal_heading_top_categories")!;
const RECENT_SLOT = getIconSlot("journal_card_recent_entries")!;
import { runJournalSqlAction } from "./journal-actions";
import { excludeWordAction } from "./journal-word-actions";

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
  // Every bar is read against the first row, which is the largest because the
  // top-N query returns them sorted. `?? 0` covers the empty list, where the
  // early return below means no bar is drawn anyway.
  const topCount = counts[0]?.entryCount ?? 0;

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
                className="min-w-0 flex-1 truncate text-ink hover:text-brass-dark hover:underline"
              >
                {count.name}
              </Link>
              {/* Relative amount, measured against the most-used name in this
                  list. Hidden narrow for the same reason as the word list's. */}
              <RankBar value={count.entryCount} max={topCount} className="max-lg:hidden" />
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

// One headline count. Local to this view, like the eight other `StatTile`s in the
// app — there is no shared stat-tile component, and design.md fixes the shape
// (container / label / value) rather than the component. No glyph and no lift:
// its siblings elsewhere carry neither, and this one sits inside a raised card.
function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-line p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      {/* Thousands separated, with a fixed locale rather than the browser's, so
          the figure doesn't change shape per visitor. */}
      <p className="mt-1 font-display text-xl text-ink">{value.toLocaleString("en-US")}</p>
    </div>
  );
}

// The ranked word list. Built as its own list rather than reusing `TaxonomyList`
// above: that one links every row to a filtered entry list and carries an
// uploaded icon per name, neither of which a word has — a word is not a
// taxonomy term, so there is nothing to filter by and nothing to illustrate.
function TopWordsList({ words }: { words: JournalWordCount[] }) {
  const router = useRouter();
  // Which word is being dismissed, so its row can show it is in flight. One at a
  // time: the server re-ranks on every change, so a second click before the first
  // lands would be acting on a list that is about to be replaced.
  const [pending, setPending] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  async function handleExclude(word: string) {
    setPending(word);
    setError(undefined);
    try {
      const result = await excludeWordAction(word);
      if (!result.ok) {
        setError(result.error ?? `Failed to exclude "${word}".`);
        return;
      }
      // The ranking is computed on the server from every entry's text, so the
      // new list arrives by re-rendering the page rather than by patching this
      // one. `revalidatePath` in the action invalidates it; this asks for it.
      router.refresh();
    } finally {
      setPending(undefined);
    }
  }

  if (words.length === 0) {
    return <p className="mt-2 text-sm text-muted">Not enough writing yet to rank words.</p>;
  }

  // Every bar is read against the most-used word, which is `words[0]` because the
  // list arrives sorted. So the top word is always a full bar and the rest are
  // its share — the differences between ranks 2-10 stay visible, which a share-of
  // -all-words scale would flatten to slivers.
  const topCount = words[0].count;

  return (
    <>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      <ul className="mt-3 flex flex-col gap-2">
        {words.map((row, index) => (
          <li key={row.word} className="flex items-center gap-2 text-sm">
            <span className="w-5 shrink-0 text-right font-mono text-xs text-muted">
              {index + 1}.
            </span>
            <span className="min-w-0 flex-1 truncate text-ink">{row.word}</span>

            {/* Relative amount, measured against the most-used word. Hidden on a
                phone, where the row has no width to spare and the count beside
                it already carries the number. */}
            <RankBar value={row.count} max={topCount} className="max-lg:hidden" />

            {/* The same fixed-size brass circle the taxonomy rows use for their
                counts, so the two lists in this card read as one system. */}
            <span
              title={`Used ${row.count.toLocaleString("en-US")} ${row.count === 1 ? "time" : "times"}`}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brass-soft font-mono text-[0.625rem] font-semibold leading-none text-brass-dark"
            >
              {row.count}
            </span>

            {/* A text link rather than a `Button`: design.md puts inline
                row-level actions as plain links, and ten pill buttons down a
                short list would be visually louder than the list itself. */}
            <button
              type="button"
              onClick={() => handleExclude(row.word)}
              disabled={pending !== undefined}
              title={`Stop counting "${row.word}"`}
              aria-label={`Stop counting "${row.word}"`}
              className="shrink-0 px-1 font-mono text-xs leading-none text-muted transition-colors hover:text-red-400 disabled:opacity-40"
            >
              {pending === row.word ? "…" : "✕"}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function CountByYears({ yearCounts }: { yearCounts: JournalYearCount[] }) {
  const router = useRouter();
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set());

  function toggleYear(year: number) {
    const newExpanded = new Set(expandedYears);
    if (newExpanded.has(year)) {
      newExpanded.delete(year);
    } else {
      newExpanded.add(year);
    }
    setExpandedYears(newExpanded);
  }

  function navigateToYearEntries(year: number) {
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;
    const query = `date >= ${startDate} and date <= ${endDate}`;
    router.push(`/modules/journal/entries?filter=${encodeURIComponent(query)}`);
  }

  function navigateToMonthEntries(year: number, month: number) {
    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    const query = `date >= ${startDate} and date <= ${endDate}`;
    router.push(`/modules/journal/entries?filter=${encodeURIComponent(query)}`);
  }

  if (yearCounts.length === 0) {
    return <p className="mt-2 text-sm text-muted">No entries yet.</p>;
  }

  return (
    <div className="mt-3 flex flex-col gap-2.5">
      {yearCounts.map((yearCount) => {
        const isExpanded = expandedYears.has(yearCount.year);

        return (
          <div
            key={yearCount.year}
            className="overflow-hidden rounded-lg border border-line bg-paper-raised"
          >
            <div className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm font-medium text-ink">
              <button
                type="button"
                onClick={() => toggleYear(yearCount.year)}
                className="flex items-center gap-2 transition-colors hover:text-brass-dark"
                title="Expand/collapse"
              >
                <span
                  className={`shrink-0 text-xs text-muted transition-transform ${isExpanded ? "rotate-90" : ""}`}
                >
                  ▶
                </span>
              </button>
              <button
                type="button"
                onClick={() => navigateToYearEntries(yearCount.year)}
                className="min-w-0 flex-1 truncate text-left transition-colors hover:text-brass-dark hover:underline"
                title={`Show all entries from ${yearCount.year}`}
              >
                {yearCount.year}
              </button>
              <span className="shrink-0 font-mono text-xs font-normal text-muted">
                {yearCount.entryCount}
              </span>
            </div>

            {isExpanded && (
              <div className="flex flex-col py-1.5 pl-4 pr-1.5">
                {yearCount.months.map((monthCount, index) => {
                  const isLast = index === yearCount.months.length - 1;
                  return (
                    <div key={monthCount.month} className="relative pl-4">
                      <span
                        aria-hidden
                        className={`absolute left-0 w-px bg-line ${isLast ? "top-0 h-[1.125rem]" : "inset-y-0"}`}
                      />
                      <span
                        aria-hidden
                        className="absolute left-0 top-[1.125rem] h-px w-3 bg-line"
                      />
                      <button
                        type="button"
                        onClick={() => navigateToMonthEntries(yearCount.year, monthCount.month)}
                        className="w-full rounded-md px-2 py-1 text-left transition-colors hover:bg-line/60"
                        title={`Show entries from ${MONTH_NAMES[monthCount.month - 1]} ${yearCount.year}`}
                      >
                        <span className="block truncate text-xs text-ink hover:text-brass-dark">
                          {MONTH_NAMES[monthCount.month - 1]}
                        </span>
                        <span className="block truncate text-xs text-muted">
                          {monthCount.entryCount} {monthCount.entryCount === 1 ? "entry" : "entries"}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function cellToText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

export function JournalView({
  entries,
  tally,
  topWords,
  topTags,
  topCategories,
  yearAndMonthCounts = [],
  categoryIcons = {},
  tagIcons = {},
  canRunSql = false,
}: {
  entries: JournalEntry[];
  /**
   * The journal's headline counts. Deliberately *not* derived from
   * `entries.length` — that array is the LIMITed recent slice, so it would read
   * as the page size once the journal grows past it.
   *
   * `lockedCount` and `logCount` are separate views of the same population
   * rather than a breakdown: a locked Log entry is in both, so the two do not
   * sum to `totalCount`.
   */
  tally: JournalEntryTally;
  /** The most-used words across every entry, already ranked and trimmed. */
  topWords: JournalWordCount[];
  topTags: JournalTaxonomyCount[];
  topCategories: JournalTaxonomyCount[];
  /** Entry counts grouped by year and month. */
  yearAndMonthCounts?: JournalYearCount[];
  /** Name -> icon URL for the Statistics lists; absent names just show no icon. */
  categoryIcons?: Record<string, string>;
  tagIcons?: Record<string, string>;
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
      {/* `defaultOpen` covers anything the card can show. It was tags-or-categories
          only; the counters and the word list live here now, and a journal with
          entries but no taxonomy would have hidden them behind a closed card. */}
      <CollapsibleCard
        title="Statistics"
        titleIcon={<SlotIcon slot={STATS_SLOT} className="h-4 w-4" />}
        defaultOpen={
          tally.totalCount > 0 ||
          topWords.length > 0 ||
          topTags.length > 0 ||
          topCategories.length > 0 ||
          yearAndMonthCounts.length > 0
        }
      >
        {/* Three counters in the house stat-tile shape (design.md -> "Stat tiles
            / summary numbers"). `max-lg:grid-cols-1` stacks them on a phone and
            leaves the desktop columns untouched — the same arrangement the
            attendance report's three tiles use. */}
        <div className="mb-8 grid grid-cols-3 gap-4 max-lg:grid-cols-1">
          <StatTile label="Total Entries" value={tally.totalCount} />
          <StatTile label="Total Locked Entries" value={tally.lockedCount} />
          <StatTile label="Total Log Entries" value={tally.logCount} />
        </div>

        {/* The ranked lists and count by years, 2x2 grid on desktop and single
            stacked column compact. `lg:grid-cols-2` with `max-lg:grid-cols-1`
            keeps the compact case a plain stack — two 10-row lists side by side
            on a phone would each be too narrow to read a name in.

            Each section is boxed rather than separated by a rule. The box is the
            quiet card treatment (`border border-line`, no shadow — design.md →
            "cards are calm"), not a nested `CollapsibleCard`. */}
        <div className="grid gap-4 lg:grid-cols-2 max-lg:grid-cols-1">
          <div className="rounded-xl border border-line p-4">
            <TaxonomyList
              heading="Top Tags"
              icon={<SlotIcon slot={TOP_TAGS_SLOT} className="h-4 w-4" />}
              counts={topTags}
              emptyMessage="No tags yet."
              hrefFor={(name) => journalEntriesFilterHref("tag", name)}
              titleFor={(name) => `Show entries tagged "${name}"`}
              iconUrls={tagIcons}
            />
          </div>
          <div className="rounded-xl border border-line p-4">
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
          <div className="rounded-xl border border-line p-4">
            <h3 className="flex items-center gap-2 font-display text-sm text-brass-dark">
              <span aria-hidden="true" className="h-4 w-4 shrink-0" />
              Top 10 Words
            </h3>
            <TopWordsList words={topWords} />
          </div>
          <div className="rounded-xl border border-line p-4">
            <h3 className="flex items-center gap-2 font-display text-sm text-brass-dark">
              <span aria-hidden="true" className="h-4 w-4 shrink-0" />
              Count by Years
            </h3>
            <CountByYears yearCounts={yearAndMonthCounts} />
          </div>
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
            // `compactLayout="record"` puts a phone on the tabbed one-record-at-a-time
            // layout: an entry is something you read, and a card that has to fit seven
            // fields truncates most of them. Desktop is unaffected.
            <DataGrid
              columns={COLUMNS}
              rows={entries}
              getRowKey={(entry) => entry.id}
              emptyMessage="No entries yet. Add one from New Journal Entry, or import a CSV."
              enableExport
              exportFileName="journal-entries"
              onRowClick={(entry) => openEntry(entry.id)}
              compactLayout="record"
              {...sqlProps}
            />
          )}
        </div>
      </CollapsibleCard>
    </div>
  );
}
