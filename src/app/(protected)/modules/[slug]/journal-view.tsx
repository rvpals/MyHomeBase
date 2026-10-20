"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { RankBar } from "@/components/rank-bar";
import { SlotIcon } from "@/components/slot-icon";
import { Tabs } from "@/components/tabs";
import { TaxonomyChip, TaxonomyIcon } from "@/components/taxonomy-icon";
import { useIsCompact } from "@/components/viewport-context";
import { getIconSlot } from "@/lib/icons";
import {
  PINNED_ENTRY_LIMIT,
  RECENTLY_EDITED_ENTRY_LIMIT,
  defaultJournalHomeWidgets,
  visibleJournalHomeWidgets,
  type JournalHomeWidgetId,
  type JournalHomeWidgetPreference,
} from "@/lib/journal";
import type {
  JournalEntry,
  JournalEntryTally,
  JournalTaxonomyCount,
  JournalWordCount,
  JournalYearCount,
} from "@/lib/journal";
import { journalEntriesFilterHref } from "./journal-shared";

// Resolved once at module scope — `getIconSlot` reads the static registry, no I/O. The
// non-null assertions are safe because slots.test.ts asserts each id is registered.
const STATS_SLOT = getIconSlot("journal_card_statistics")!;
const TOP_TAGS_SLOT = getIconSlot("journal_heading_top_tags")!;
const TOP_CATEGORIES_SLOT = getIconSlot("journal_heading_top_categories")!;
const RECENT_SLOT = getIconSlot("journal_card_recent_entries")!;
// The combined card's header, then the two tab labels inside it.
const PINNED_AND_EDITED_SLOT = getIconSlot("journal_card_pinned_and_recently_edited")!;
const PINNED_SLOT = getIconSlot("journal_card_pinned_entries")!;
const RECENTLY_EDITED_SLOT = getIconSlot("journal_card_recently_edited_entries")!;
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

// Just date and title for the Pinned Entries card. Deliberately far narrower than the
// recent-entries grid: this card sits in one half of a two-column layout, and it is a
// shortlist you scan rather than a table you read. Everything else about an entry —
// place, categories, tags, locations — is one click away, because the row opens it.
const PINNED_COLUMNS: DataGridColumn<JournalEntry>[] = [
  { key: "date", header: "Date", value: (entry) => entry.date, render: (entry) => entry.date },
  { key: "title", header: "Title", value: (entry) => entry.title, render: (entry) => entry.title },
];

/**
 * The Recently Edited tab carries one column the Pinned tab doesn't: when it was
 * edited, which is the whole reason the list is in that order. `date` stays too —
 * they answer different questions ("when it happened" vs "when I last touched it"),
 * and an entry dated years ago that you edited this morning is exactly the row this
 * tab exists to surface.
 */
const RECENTLY_EDITED_COLUMNS: DataGridColumn<JournalEntry>[] = [
  { key: "date", header: "Date", value: (entry) => entry.date, render: (entry) => entry.date },
  { key: "title", header: "Title", value: (entry) => entry.title, render: (entry) => entry.title },
  {
    key: "updatedAt",
    header: "Edited",
    // Sorts on the raw ISO timestamp but shows the date part: the time of day is
    // noise in a shortlist, while the stored string is what makes the column sort
    // correctly if the reader clicks the header.
    value: (entry) => entry.updatedAt,
    render: (entry) => entry.updatedAt.slice(0, 10),
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

// One taxonomy summary inside the Statistics card. Local to this view — Top Tags
// and Top Categories are the only two, and they differ only in their heading,
// glyph and the filter link each entry points at.
//
// **Two genuinely different shapes, not one restyled.** Full draws a tile grid
// (icon above name above count); compact draws a row of chips. That is why this
// reads `useIsCompact()` rather than leaning on `max-lg:` variants — design.md
// licenses the hook exactly when the small screen needs a different component.
//
// Both shapes deliberately drop the rank number and the `RankBar` the old list
// carried: the count under each tile is the ranking signal now, and the entries
// still arrive sorted, so reading order carries the rest. Confirmed with Min
// before building — the tiles were chosen knowing the bars go away.
/**
 * One ranked taxonomy list — the body of a tab, not a card of its own.
 *
 * No heading: the two lists live in a tabbed card now, and the tab's own label
 * carries the name and the slot icon. A heading here would say "Top Tags"
 * directly under a selected tab reading "Top Tags".
 */
function TaxonomyList({
  counts,
  emptyMessage,
  hrefFor,
  titleFor,
  iconUrls,
}: {
  counts: JournalTaxonomyCount[];
  emptyMessage: string;
  hrefFor: (name: string) => string;
  titleFor: (name: string) => string;
  /** Name -> uploaded icon URL. Names without an icon are simply absent. */
  iconUrls: Record<string, string>;
}) {
  const isCompact = useIsCompact();

  return (
    <section>
      {counts.length === 0 ? (
        <p className="text-sm text-muted">{emptyMessage}</p>
      ) : isCompact ? (
        // Chips wrap to as many lines as they need. No fixed column, so a long
        // name costs its own width rather than widening every row.
        <div className="flex flex-wrap gap-1.5">
          {counts.map((count) => (
            <TaxonomyChip
              key={count.name}
              url={iconUrls[count.name]}
              name={count.name}
              href={hrefFor(count.name)}
              title={titleFor(count.name)}
            />
          ))}
        </div>
      ) : (
        // `auto-FIT`, not `auto-fill`: both collapse to the same thing when the
        // tiles fill the row, but `auto-fill` keeps generating empty 5rem tracks
        // past the last tile. Once Top Tags and Top Categories were combined into
        // one full-width card each list got roughly double its old width, and those
        // phantom tracks showed up as a wide blank band between the two lists —
        // pushing the divider far from where the tiles actually ended. `auto-fit`
        // collapses the empty tracks so the list ends at its last tile.
        //
        // The max is `6rem`, not `1fr`: with `auto-fit` a `1fr` max would stretch
        // the surviving tiles to swallow the collapsed tracks, turning ten tiles
        // into ten wide rectangles. Capping it keeps a tile roughly square and
        // lets the row simply end.
        <ul className="grid justify-start gap-2 [grid-template-columns:repeat(auto-fit,minmax(5rem,6rem))]">
          {counts.map((count) => (
            <li key={count.name}>
              {/* A real Link, so middle-click and ⌘-click open the filtered
                  list in a new tab like any other navigation. */}
              <Link
                href={hrefFor(count.name)}
                title={titleFor(count.name)}
                className="flex h-full flex-col items-center gap-1.5 rounded-xl border border-line px-1 py-2.5 transition-colors hover:border-brass"
              >
                {/* `spacer` keeps a tile with no icon the same height as its
                    neighbours, so the grid rows stay level. */}
                <TaxonomyIcon
                  url={iconUrls[count.name]}
                  name={count.name}
                  size="lg"
                  fallback="spacer"
                />
                <span className="w-full truncate text-center text-xs text-ink">{count.name}</span>
                <span
                  title={`${count.entryCount} ${count.entryCount === 1 ? "entry" : "entries"}`}
                  className="font-mono text-[0.625rem] font-semibold leading-none text-muted"
                >
                  {count.entryCount.toLocaleString("en-US")}
                </span>
              </Link>
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
function StatTile({
  label,
  value,
  href,
  title,
}: {
  label: string;
  value: number;
  /**
   * Where the tile goes when clicked. Optional because "Total Entries" has no
   * destination worth having — the Entries section unfiltered is one nav click
   * away and the tile would just be a second route to it.
   */
  href?: string;
  /** Hover hint, so the destination is readable before committing to the click. */
  title?: string;
}) {
  // The box is identical either way; only the wrapper differs. Written as one
  // `body` reused by both branches rather than two near-copies, so a later
  // change to the tile's shape can't drift between the linked and plain cases.
  const body = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      {/* Thousands separated, with a fixed locale rather than the browser's, so
          the figure doesn't change shape per visitor. */}
      <p className="mt-1 font-display text-xl text-ink">{value.toLocaleString("en-US")}</p>
    </>
  );

  if (!href) return <div className="rounded-xl border border-line p-4">{body}</div>;

  // `block` so the whole tile is the target, not just the text inside it — a
  // card-sized hit area is the point on a phone. Hover lifts the border to brass
  // rather than adding a shadow: design.md → "cards are calm", and the tile sits
  // inside a raised card already.
  return (
    <Link
      href={href}
      title={title}
      className="block rounded-xl border border-line p-4 transition-colors hover:border-brass focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
    >
      {body}
    </Link>
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
            {/* `shrink-0`, not `flex-1`: stretching the word pushed the bar, the
                count and the ✕ out to the right edge and left a gulf after a short
                word like "the". The bar below takes the slack instead, which is the
                element that actually wants the width. `max-w-[9rem]` still truncates
                a pathological word rather than squeezing the bar to nothing. */}
            <span className="min-w-0 max-w-[9rem] shrink-0 truncate text-ink">{row.word}</span>

            {/* Relative amount, measured against the most-used word. Takes the row's
                spare width, so the bar grows instead of a gap. Hidden on a phone,
                where the row has no width to spare and the count beside it already
                carries the number — `flex-1` there would reintroduce the gulf, so
                the spacer after this picks the slack up once the bar is gone. */}
            {/* `w-auto grow` overrides RankBar's own `w-12 shrink-0` defaults, which
                are sized for a narrow cell — its className is merged last, so the
                width has to be restated rather than just adding `flex-1`. */}
            <RankBar
              value={row.count}
              max={topCount}
              className="min-w-0 w-auto grow max-lg:hidden"
            />
            <span aria-hidden className="hidden min-w-0 flex-1 max-lg:block" />

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
    // Years pack into as many columns as the card's width allows rather than one
    // tall stack: a year row is intrinsically ~9rem wide, so a single column left
    // most of this half-width card empty. `auto-fill` rather than a fixed count
    // because the content area differs between a laptop and a wide monitor — this
    // gives 2 columns on one and 3-4 on the other with no breakpoint to tune.
    // `items-start` stops a collapsed year stretching to match an expanded
    // neighbour; an expanded year grows in place, so clicking one never relays out
    // the rest of the card. A phone stays the single stack it already was.
    <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] items-start gap-2.5 max-lg:grid-cols-1">
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
              {/* The year and its count sit together. Neither grows: the row is a
                  ~9rem grid cell now, so there is no leftover width to distribute
                  and no gulf to open up between a four-character year and a
                  one-character count. */}
              <button
                type="button"
                onClick={() => navigateToYearEntries(yearCount.year)}
                className="min-w-0 shrink-0 truncate text-left transition-colors hover:text-brass-dark hover:underline"
                title={`Show all entries from ${yearCount.year}`}
              >
                {yearCount.year}
              </button>
              {/* The house chip: `rounded-full bg-brass-soft … text-brass-dark`
                  (design.md → brassSoft is the tinted chip/badge background).
                  `tabular-nums` keeps the oval from jumping width between rows. */}
              <span className="shrink-0 rounded-full bg-brass-soft px-2 py-0.5 text-xs font-semibold tabular-nums text-brass-dark">
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

// The cards that take the whole row on desktop; the other four are half-width.
// `topTaxonomy` stays full-width now that its two lists are tabs rather than
// columns: the tile grid is the reason, not the old side-by-side layout. Tiles are
// capped at 6rem, so a full-width row fits roughly twice as many before wrapping,
// and the ten of them read as a block instead of a narrow strip.
const FULL_WIDTH_WIDGETS = new Set<JournalHomeWidgetId>([
  "counters",
  "topTaxonomy",
  // Full-width for the same reason `topTaxonomy` is: two tabbed lists in one card.
  // The Recently Edited tab carries three columns and up to 20 rows, which in a
  // half-width cell would truncate titles against the Edited column.
  "pinnedAndRecentlyEdited",
  "recentEntries",
]);

export function JournalView({
  entries,
  tally,
  topWords,
  topTags,
  topCategories,
  yearAndMonthCounts = [],
  pinnedEntries = [],
  recentlyEditedEntries = [],
  categoryIcons = {},
  tagIcons = {},
  canRunSql = false,
  widgets = defaultJournalHomeWidgets(),
}: {
  entries: JournalEntry[];
  /**
   * The journal's headline counts. Deliberately *not* derived from
   * `entries.length` — that array is the LIMITed recent slice, so it would read
   * as the page size once the journal grows past it.
   *
   * `lockedCount` and `logCount` are separate views of the same population
   * rather than a breakdown: a locked Log entry is in both, so the two do not
   * sum to `totalCount`. `recycledCount` is different again — binned entries
   * have left the journal, so it counts rows `totalCount` does not include.
   */
  tally: JournalEntryTally;
  /** The most-used words across every entry, already ranked and trimmed. */
  topWords: JournalWordCount[];
  topTags: JournalTaxonomyCount[];
  topCategories: JournalTaxonomyCount[];
  /** Entry counts grouped by year and month. */
  yearAndMonthCounts?: JournalYearCount[];
  /**
   * The pinned entries for the Pinned tab, newest first and already capped by
   * `listPinnedEntries`. Separate from `entries`, which is the recent slice — a
   * pinned entry is often an old one, so it would not be in that list.
   */
  pinnedEntries?: JournalEntry[];
  /**
   * The recently-edited entries for the other tab of the same card, newest edit
   * first and already capped by `listRecentlyEditedEntries`. Also separate from
   * `entries`: that list is ordered by the date an entry is *about*, this one by
   * when it was last touched, so an old entry edited today appears here and not
   * there.
   */
  recentlyEditedEntries?: JournalEntry[];
  /** Name -> icon URL for the Statistics lists; absent names just show no icon. */
  categoryIcons?: Record<string, string>;
  tagIcons?: Record<string, string>;
  /** Only admins may run SQL; the server action re-checks this. */
  canRunSql?: boolean;
  /** This reader's card order and visibility. Defaults to every card, catalogue order. */
  widgets?: JournalHomeWidgetPreference[];
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

  // One node per card, drawn in the reader's saved order (Configuration -> Home screen
  // layout) and skipping the ones they switched off. Each is the quiet card treatment
  // — `border border-line`, no shadow (design.md -> "cards are calm").
  const cards: Record<JournalHomeWidgetId, ReactNode> = {
    counters: (
      <div className="rounded-xl border border-line p-4">
        <h3 className="mb-3 flex items-center gap-2 font-display text-sm text-brass-dark">
          <SlotIcon slot={STATS_SLOT} className="h-4 w-4 shrink-0" />
          Statistics
        </h3>
        {/* Four counters in the house stat-tile shape (design.md -> "Stat tiles /
            summary numbers"). `max-lg:grid-cols-1` stacks them on a phone and leaves
            the desktop columns untouched. */}
        <div className="grid grid-cols-4 gap-4 max-lg:grid-cols-1">
          <StatTile label="Total Entries" value={tally.totalCount} />
          <StatTile
            label="Total Locked Entries"
            value={tally.lockedCount}
            // `locked = yes` is the filter grammar's own spelling (filter-query.ts
            // maps `locked` → `isLocked`), so this is the same link the reader
            // could have typed into the Entries filter box themselves.
            href={`/modules/journal/entries?filter=${encodeURIComponent("locked = yes")}`}
            title="Show every locked entry"
          />
          <StatTile
            label="Total Log Entries"
            value={tally.logCount}
            // The Log tab, not a Main filtered to `category = Log`: the tab IS the old
            // Log section, with the grid and viewer built for these rows.
            href="/modules/journal/entries?tab=log"
            title="Show the Log tab"
          />
          <StatTile
            label="Total Recycled Entries"
            value={tally.recycledCount}
            href="/modules/journal/recycle-bin"
            title="Show the recycle bin"
          />
        </div>
      </div>
    ),
    // Tags and categories share one card and one space, a tab each. Side by side they
    // each got half the width, which on a `minmax(5rem,6rem)` tile grid is a visible
    // cost — a tab gets the whole card. They are two cuts of the same question ("what
    // do I write about most"), read one at a time, which is what tabs are for
    // (components.md → Tabs vs ViewModeSwitch).
    //
    // The tab label carries each list's name and slot icon, so `TaxonomyList` no
    // longer draws a heading of its own. Same strip on a phone: two short labels fit
    // a narrow screen, and `Tabs` wraps them if they ever don't.
    topTaxonomy: (
      <div className="rounded-xl border border-line p-4">
        <Tabs
          items={[
            {
              key: "tags",
              label: (
                <span className="flex items-center gap-2">
                  <SlotIcon slot={TOP_TAGS_SLOT} className="h-4 w-4 shrink-0" />
                  Top Tags
                </span>
              ),
              content: (
                <TaxonomyList
                  counts={topTags}
                  emptyMessage="No tags yet."
                  hrefFor={(name) => journalEntriesFilterHref("tag", name)}
                  titleFor={(name) => `Show entries tagged "${name}"`}
                  iconUrls={tagIcons}
                />
              ),
            },
            {
              key: "categories",
              label: (
                <span className="flex items-center gap-2">
                  <SlotIcon slot={TOP_CATEGORIES_SLOT} className="h-4 w-4 shrink-0" />
                  Top Categories
                </span>
              ),
              content: (
                <TaxonomyList
                  counts={topCategories}
                  emptyMessage="No categories yet."
                  hrefFor={(name) => journalEntriesFilterHref("category", name)}
                  titleFor={(name) => `Show entries in "${name}"`}
                  iconUrls={categoryIcons}
                />
              ),
            },
          ]}
        />
      </div>
    ),
    topWords: (
      <div className="rounded-xl border border-line p-4">
        <h3 className="flex items-center gap-2 font-display text-sm text-brass-dark">
          <span aria-hidden="true" className="h-4 w-4 shrink-0" />
          Top 10 Words
        </h3>
        <TopWordsList words={topWords} />
      </div>
    ),
    countByYears: (
      <div className="rounded-xl border border-line p-4">
        <h3 className="flex items-center gap-2 font-display text-sm text-brass-dark">
          <span aria-hidden="true" className="h-4 w-4 shrink-0" />
          Count by Years
        </h3>
        <CountByYears yearCounts={yearAndMonthCounts} />
      </div>
    ),
    // Two shortlists of entries in one card, as tabs: the ones the reader pinned, and
    // the ones they edited most recently. Neither is a second Entries list — each is
    // capped and links to the full filtered list for the rest, which is why they carry
    // no toolbar and no export.
    //
    // One card rather than two because they answer the same kind of question ("which
    // entries do I want to get back to") and halve the vertical room doing it. Same
    // arrangement as the Statistics card, which holds Top Tags and Top Categories.
    pinnedAndRecentlyEdited: (
      <CollapsibleCard
        title="Pinned & Recently Edited"
        titleIcon={<SlotIcon slot={PINNED_AND_EDITED_SLOT} className="h-4 w-4" />}
        // Open when either tab has something to show, shut when neither does — the
        // same rule Today In History uses, so an empty card costs a line, not a hole.
        defaultOpen={pinnedEntries.length > 0 || recentlyEditedEntries.length > 0}
      >
        <Tabs
          items={[
            {
              key: "pinned",
              label: (
                <span className="flex items-center gap-1.5">
                  <SlotIcon slot={PINNED_SLOT} className="h-4 w-4" />
                  Pinned
                </span>
              ),
              content: (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm text-muted">
                      {pinnedEntries.length === 0
                        ? "Nothing pinned yet. Open an entry and press the pin to keep it here."
                        : `Showing ${pinnedEntries.length === PINNED_ENTRY_LIMIT ? `the first ${PINNED_ENTRY_LIMIT}` : `${pinnedEntries.length}`} pinned ${pinnedEntries.length === 1 ? "entry" : "entries"}, newest first. Click a row to open it.`}
                    </p>
                    {/* Moved out of the card header and into the tab body: the two tabs
                        go to different lists, so a single header action could only ever
                        be right for whichever tab happened to be open. */}
                    {pinnedEntries.length > 0 && (
                      <Button
                        size="sm"
                        variant="secondary"
                        // `pinned = yes` is the filter grammar's own spelling
                        // (filter-query.ts maps `pinned` → `isPinned`), so this is the
                        // same link the reader could have typed into the Entries
                        // filter box themselves.
                        href={`/modules/journal/entries?filter=${encodeURIComponent("pinned = yes")}`}
                        title="Show every pinned entry"
                      >
                        View all
                      </Button>
                    )}
                  </div>

                  <div className="mt-3">
                    {/* No `compactLayout="record"` here, unlike the recent-entries
                        grid: that exists because seven columns can't fit a phone, and
                        two comfortably can. A date beside a title is the same shape on
                        both screens. */}
                    <DataGrid
                      columns={PINNED_COLUMNS}
                      rows={pinnedEntries}
                      getRowKey={(entry) => entry.id}
                      emptyMessage="No pinned entries."
                      showStatusBar={false}
                      // A shortlist on a dashboard card: search, filters, the column
                      // picker and density are all chrome here. Same call as Today In
                      // History.
                      showToolbar={false}
                      onRowClick={(entry) => openEntry(entry.id)}
                      // No record-view eye. It opens a modal listing every column,
                      // which on a two-column card would read out the date and title
                      // already on screen — and the row click opens the entry itself,
                      // which is the fuller answer to the same question.
                      enableRecordView={false}
                    />
                  </div>
                </>
              ),
            },
            {
              key: "recently-edited",
              label: (
                <span className="flex items-center gap-1.5">
                  <SlotIcon slot={RECENTLY_EDITED_SLOT} className="h-4 w-4" />
                  Recently Edited
                </span>
              ),
              content: (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm text-muted">
                      {recentlyEditedEntries.length === 0
                        ? "No entries yet. Once you write or edit one it will show up here."
                        : `Showing the ${recentlyEditedEntries.length === RECENTLY_EDITED_ENTRY_LIMIT ? `last ${RECENTLY_EDITED_ENTRY_LIMIT} entries` : `${recentlyEditedEntries.length} ${recentlyEditedEntries.length === 1 ? "entry" : "entries"}`} you edited, most recent first. Click a row to open it.`}
                    </p>
                    {/* No "View all" on this tab, unlike Pinned. The Entries section
                        reads `?filter=` only, and the filter grammar has no sort
                        syntax (filter-query.ts parses conditions, not ordering), so
                        there is no URL that means "every entry, newest edit first".
                        A link to the default-sorted list would quietly land the
                        reader on a *differently ordered* list than the one they
                        clicked from, which is worse than no link. Sorting in the
                        Entries filter builder is the way there until a `?sort=`
                        param exists. */}
                  </div>

                  <div className="mt-3">
                    <DataGrid
                      columns={RECENTLY_EDITED_COLUMNS}
                      rows={recentlyEditedEntries}
                      getRowKey={(entry) => entry.id}
                      emptyMessage="No entries yet."
                      showStatusBar={false}
                      showToolbar={false}
                      onRowClick={(entry) => openEntry(entry.id)}
                      enableRecordView={false}
                    />
                  </div>
                </>
              ),
            },
          ]}
        />
      </CollapsibleCard>
    ),
    // The latest-entries grid and its "Show SQL" re-run live in a collapsible card of
    // their own. Starts expanded — it's the thing most visits here are for. The card
    // keeps its "Recent entries" title even while a re-run's result is showing; the
    // body says which of the two you're looking at.
    recentEntries: (
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
    ),
  };

  return (
    // Two columns on desktop so the ranked lists sit side by side as they did inside
    // the old Statistics card; the counters and the entries grid span both. A phone is
    // always one stack. `items-start` keeps a short card from stretching to its row.
    <div className="grid grid-cols-2 items-start gap-6 max-lg:grid-cols-1">
      {visibleJournalHomeWidgets(widgets).map((id) => (
        <div
          key={id}
          className={`min-w-0 ${FULL_WIDTH_WIDGETS.has(id) ? "col-span-2 max-lg:col-span-1" : ""}`}
        >
          {cards[id]}
        </div>
      ))}
    </div>
  );
}