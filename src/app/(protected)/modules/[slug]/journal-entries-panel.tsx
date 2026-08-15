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

import {
  describeFilter,
  emptyFilter,
  findEntries,
  listCategories,
  listFilters,
  listTags,
  tryParseFilterQuery,
  type JournalFilter,
} from "@/lib/journal";
import { deps } from "@/lib/wiring";
import { JournalEntriesView } from "./journal-entries-view";

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
  /** Optional heading, for embedding outside the Entries section. */
  title?: string;
  description?: string;
}

export function JournalEntriesPanel({
  filterName,
  filterQuery,
  title,
  description,
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
  const entries = queryError ? [] : findEntries(deps.journalRepo, filter, ENTRIES_LIMIT);

  return (
    <JournalEntriesView
      initialEntries={entries}
      initialFilters={savedFilters}
      categoryOptions={listCategories(deps.journalRepo).map((category) => category.name)}
      tagOptions={listTags(deps.journalRepo).map((tag) => tag.name)}
      initialFilterId={initialFilterId}
      appliedQuery={appliedQuery}
      queryError={queryError}
      title={title}
      description={description}
    />
  );
}
