// Server-side wrapper around JournalEntriesView. **This is the thing to reuse**
// when you want a list of journal entries somewhere: it takes a filter by name or
// as a query string, does the reads, and hands the client view plain data.
//
// It exists because resolving `filterName` means hitting the database, and
// JournalEntriesView is a client component that can't. Splitting them keeps the
// view pure presentation (props in, events out) and puts the one impure step in a
// server component — the same division journal-section.tsx already uses.
//
//   <JournalEntriesPanel filterName="Trips" />
//   <JournalEntriesPanel filterQuery="category = TRIP and title ~ beach" />
//   <JournalEntriesPanel />                       // everything, unfiltered
//
// A supplied filter is **pre-selected, not locked**: the dropdown stays live so
// the reader can switch away from it.
//
// Four tabs, all read here: **All Entries** (every entry, which the filter above
// narrows), **Unlocked Entries** (the same, minus the locked ones),
// **Substantial Entries** (the same, minus the short and the encrypted) and
// **Log** (the logged activities, unfiltered). A supplied
// `filterName`/`filterQuery` applies to all three grid tabs — All Entries is the
// one a deep link from the Top Tags/Categories cards lands on.

import {
  describeFilter,
  emptyFilter,
  entriesSql,
  findEntries,
  listCategories,
  listFilters,
  listLogEntries,
  listTags,
  tryParseFilterQuery,
  withLockedCondition,
  withLogCondition,
  type JournalFilter,
} from "@/lib/journal";
import { deps } from "@/lib/wiring";
// The bulk-edit dialog's "From your saved places" tab filters by these. They are
// the *place* taxonomy from the application-wide library, unrelated to the entry
// categories/tags above.
import { listLocationCategories, listLocationTags } from "@/lib/sys-locations";
import { JournalEntriesView } from "./journal-entries-view";
import { journalTaxonomyIconUrlsByName } from "./journal-shared";

/** Matches ENTRIES_RESULT_LIMIT in journal-actions.ts, so the first render and a
 *  later filtered re-query are capped the same way. */
const ENTRIES_LIMIT = 500;

export interface JournalEntriesPanelProps {
  /**
   * Name of a saved filter to start on. Matched case-insensitively, since the
   * caller is typing it by hand and the stored casing is the user's.
   */
  filterName?: string;
  /**
   * An ad-hoc filter query, e.g. `category = TRIP and title ~ beach`. See
   * src/lib/journal/filter-query.ts for the grammar. Ignored when `filterName`
   * is also given — a named filter is the more specific instruction.
   */
  filterQuery?: string;
  /**
   * Which tab to open on — "log" for the Log tab, "main" for All Entries,
   * "substantial" for Substantial Entries, anything else (or nothing) for
   * Unlocked Entries, which is the first tab and the default. Not validated
   * here: the view matches the key against the four it knows and falls back to
   * "unlocked", so a stale `?tab=` opens the default rather than 404ing.
   */
  initialTab?: string;
  /** Optional heading, for embedding outside the Entries section. */
  title?: string;
  description?: string;
  /**
   * Whether the viewer may see and re-run the query behind each grid. Admins
   * only, decided by the caller, which is the component that knows the session.
   * Presentation only — `runJournalSqlAction` re-checks the role on the server.
   */
  canRunSql?: boolean;
}

export function JournalEntriesPanel({
  filterName,
  filterQuery,
  initialTab,
  title,
  description,
  canRunSql = false,
}: JournalEntriesPanelProps) {
  const savedFilters = listFilters(deps.journalRepo);

  let filter: JournalFilter = emptyFilter();
  let initialFilterId: number | undefined;
  let appliedQuery: { text: string; description: string } | undefined;
  let queryError: string | undefined;

  if (filterName !== undefined && filterName.trim() !== "") {
    const wanted = filterName.trim().toLowerCase();
    const match = savedFilters.find((candidate) => candidate.name.toLowerCase() === wanted);
    if (match) {
      filter = match.filter;
      initialFilterId = match.id;
    } else {
      // Named-but-missing is reported, never silently unfiltered: a caller asking
      // for "Trips" and getting the whole journal would look like it worked.
      const available = savedFilters.map((candidate) => candidate.name).join(", ");
      queryError =
        savedFilters.length === 0
          ? `No saved filter named "${filterName.trim()}" — no filters have been saved yet.`
          : `No saved filter named "${filterName.trim()}". Available: ${available}.`;
    }
  } else if (filterQuery !== undefined && filterQuery.trim() !== "") {
    const parsed = tryParseFilterQuery(filterQuery);
    if (parsed.ok) {
      filter = parsed.filter;
      appliedQuery = { text: filterQuery.trim(), description: describeFilter(parsed.filter) };
    } else {
      queryError = parsed.error;
    }
  }

  // A filter that was asked for but couldn't be resolved lists **nothing**. The
  // alternative — falling back to every entry — is indistinguishable from a
  // filter that matched everything, which is the failure most likely to mislead.
  //
  // The All Entries tab's rows: the reader's filter with **no Log condition** —
  // it is every entry, logged activities included. It used to exclude them,
  // which made a deep link from the Statistics card dead for any tag carried
  // only by Log entries: the card counted them and this list was defined not to
  // show them. The Log tab is now the one that narrows, rather than partitioning.
  const scopedFilter = withLogCondition(filter, "all");
  const entries = queryError ? [] : findEntries(deps.journalRepo, scopedFilter, ENTRIES_LIMIT);

  // The Unlocked tab's first page: a read of its own, **not** `entries` filtered
  // down. Both lists are capped at ENTRIES_LIMIT, so narrowing the All Entries
  // page here would drop any unlocked entry that fell past the cap — the list
  // would silently be the unlocked subset of the first 500, not the first 500
  // unlocked. The condition is the same one findJournalEntriesAction and the
  // bulk refresh re-apply, so all three agree.
  const unlockedFilter = withLockedCondition(scopedFilter, "unlocked");
  const unlockedEntries = queryError
    ? []
    : findEntries(deps.journalRepo, unlockedFilter, ENTRIES_LIMIT);

  // The Substantial tab's first page — a read of its own, for the same reason
  // the unlocked list is: narrowing `entries` here would give the substantial
  // subset of the first 500 rather than the first 500 substantial. The
  // body-length condition rides beside the filter rather than inside it,
  // because the filter schema would drop it; see src/lib/journal/body-length.ts.
  const substantialEntries = queryError
    ? []
    : findEntries(deps.journalRepo, scopedFilter, ENTRIES_LIMIT, "substantial");

  // Each tab's statement, built from the same scoped filter its rows came from.
  //
  // Still built when `queryError` is set — that is the state someone is most
  // likely to be opening this dialog to understand. There is no "wrong SQL" to
  // show in that case: tryParseFilterQuery throws before producing a filter, so
  // nothing was ever compiled and `filter` is still the empty one. Showing that
  // empty query bare would be a lie, because it returns every entry while the
  // grid shows none — so what actually happened is appended as SQL comments.
  //
  // They go *after* the statement, never before it: the re-run guard is
  // `/^\s*SELECT\b/` (sql-explorer/schema.ts), so a leading comment would make
  // the dialog's own text fail to run with "Only SELECT queries are allowed
  // here." Trailing comments keep it runnable.
  const sqlFor = (filterForTab: JournalFilter, bodyScope: "all" | "substantial" = "all") => {
    if (!canRunSql) return undefined;
    const statement = entriesSql(deps.journalRepo, filterForTab, ENTRIES_LIMIT, bodyScope);
    if (!queryError) return statement;
    return [
      statement,
      "",
      "-- NOTE: the filter query above could not be read, so this screen ran",
      "-- nothing and the grid lists no rows. The statement above is the",
      "-- UNFILTERED fallback -- running it returns every entry, which is NOT",
      "-- what the grid is showing.",
      `-- Filter query: ${filterQuery ?? ""}`,
      `-- Parser said: ${queryError}`,
    ].join("\n");
  };

  // The Log tab is the section that used to live at /modules/journal/log, moved
  // in whole: the same unfiltered list, and the same two icon maps its viewer
  // modal renders an entry's categories and tags with.
  const categories = listCategories(deps.journalRepo);
  const tags = listTags(deps.journalRepo);

  return (
    <JournalEntriesView
      initialEntries={entries}
      initialUnlockedEntries={unlockedEntries}
      initialSubstantialEntries={substantialEntries}
      initialSql={sqlFor(scopedFilter)}
      initialUnlockedSql={sqlFor(unlockedFilter)}
      initialSubstantialSql={sqlFor(scopedFilter, "substantial")}
      canRunSql={canRunSql}
      initialFilters={savedFilters}
      categoryOptions={categories.map((category) => category.name)}
      tagOptions={tags.map((tag) => tag.name)}
      locationCategoryOptions={listLocationCategories(deps.sysLocationRepo).map(
        (row) => row.name,
      )}
      locationTagOptions={listLocationTags(deps.sysLocationRepo).map((row) => row.name)}
      initialFilterId={initialFilterId}
      appliedQuery={appliedQuery}
      queryError={queryError}
      initialTab={initialTab}
      title={title}
      description={description}
      logEntries={listLogEntries(deps.journalRepo, ENTRIES_LIMIT)}
      categoryIcons={Object.fromEntries(journalTaxonomyIconUrlsByName("category", categories))}
      tagIcons={Object.fromEntries(journalTaxonomyIconUrlsByName("tag", tags))}
    />
  );
}
