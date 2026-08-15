// Domain models for the MyJournal module. These are the shapes the rest of the
// app sees — the repository maps the flat jrn_ table rows into these and back.

// Weather is stored as four flattened columns on jrn_entries but modeled here as
// a single optional object: an entry either has weather or it doesn't.
export interface Weather {
  temp: number;
  unit: string;
  description: string;
  code: number;
}

export interface EntryLocation {
  id: number;
  entryId: number;
  latitude: number;
  longitude: number;
  locationName: string;
  sortOrder: number;
}

// An entry is an aggregate: it carries its own categories, tags, and locations
// rather than exposing them as separate top-level lists. Images and icons are
// deferred until the view is built.
export interface JournalEntry {
  id: number;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM (may be empty)
  title: string;
  content: string;
  placeName: string;
  weather?: Weather;
  isPinned: boolean;
  isLocked: boolean;
  categories: string[]; // category names, referencing JournalCategory.name
  tags: string[]; // tag names, referencing JournalTag.name
  locations: EntryLocation[];
  createdAt: string;
  updatedAt: string;
}

export interface JournalCategory {
  name: string;
  description: string;
  /**
   * Mime type of the category's icon, or undefined when none is set. The bytes
   * themselves are fetched separately (see JournalTaxonomyIcon) so they never
   * travel with a category list.
   */
  iconMimeType?: string;
  createdAt: string;
  updatedAt: string;
}

export interface JournalTag {
  name: string;
  description: string;
  /** Same deal as JournalCategory.iconMimeType, for a tag's icon. */
  iconMimeType?: string;
  createdAt: string;
  updatedAt: string;
}

/** Raw icon bytes for one category or tag, read only by the icon-serving routes. */
export interface JournalTaxonomyIcon {
  data: Buffer;
  mimeType: string;
}

// --- Saved entry filters -----------------------------------------------------
//
// A filter is one level of AND/OR groups, each holding conditions joined by its
// own AND/OR — enough for "(A or B) and C" without becoming an arbitrary tree.
// Stored as JSON in jrn_saved_filters.filter_json; see migration 0043 for why.

/** The entry fields a condition can test. GPS/location is anticipated, not built. */
export type JournalFilterField =
  | "date"
  | "time"
  | "title"
  | "content"
  | "placeName"
  | "category"
  | "tag"
  | "isPinned"
  | "isLocked";

export type JournalFilterOperator =
  | "contains"
  | "notContains"
  | "equals"
  | "before"
  | "after"
  | "between"
  | "hasAny"
  | "hasNone"
  | "is"
  | "isEmpty"
  | "isNotEmpty";

export type JournalFilterJoin = "AND" | "OR";

/**
 * One test against one field. Which of `value` / `valueTo` / `values` is used
 * depends on the operator: `between` takes both bounds, the taxonomy operators
 * take `values`, `isEmpty`/`isNotEmpty` take none, everything else takes `value`.
 *
 * A single flat shape rather than a discriminated union per operator, because the
 * builder UI swaps operators on a half-filled row and a union would force it to
 * discard whatever the user had already typed.
 */
export interface JournalFilterCondition {
  field: JournalFilterField;
  operator: JournalFilterOperator;
  /** Single value, or the lower bound of a `between`. Booleans use "true"/"false". */
  value?: string;
  /** Upper bound of a `between`. */
  valueTo?: string;
  /** Category/tag names, for `hasAny` / `hasNone`. */
  values?: string[];
}

export interface JournalFilterGroup {
  /** How this group's own conditions combine. */
  join: JournalFilterJoin;
  conditions: JournalFilterCondition[];
}

export interface JournalFilter {
  /** How the groups combine with each other. */
  join: JournalFilterJoin;
  groups: JournalFilterGroup[];
}

/** A named filter as stored. */
export interface SavedJournalFilter {
  id: number;
  name: string;
  filter: JournalFilter;
  createdAt: string;
  updatedAt: string;
}

/**
 * A tag or category paired with how many entries carry it — the shape behind
 * the "Top Tags" / "Top Categories" lists on the journal home screen.
 */
export interface JournalTaxonomyCount {
  name: string;
  entryCount: number;
}

// Just enough of an entry to link to it (used for previous/next navigation).
export interface JournalEntryRef {
  id: number;
  date: string;
  title: string;
}

/**
 * The entries adjacent to one entry in the journal's standard order
 * (entry_date, entry_time, id). `previous` is the **older** neighbour and `next`
 * the **newer** one; either is absent at the ends of the journal.
 */
export interface JournalEntryNeighbors {
  previous?: JournalEntryRef;
  next?: JournalEntryRef;
}

// An entry from a previous year that shares today's month and day, paired with
// how long ago it was. Because the month/day match exactly, yearsAgo is a whole
// number of years — no partial-year rounding is involved.
export interface TodayInHistoryEntry {
  entry: JournalEntry;
  yearsAgo: number;
}

export type JournalTemperatureUnit = "celsius" | "fahrenheit";

export interface JournalDefaultLocation {
  latitude: number;
  longitude: number;
  name: string;
}

// User preferences for the journal module, persisted as module settings rows.
export interface JournalPreferences {
  defaultLocation: JournalDefaultLocation | null;
  temperatureUnit: JournalTemperatureUnit;
}
