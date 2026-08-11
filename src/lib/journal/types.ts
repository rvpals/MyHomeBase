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
  createdAt: string;
  updatedAt: string;
}

export interface JournalTag {
  name: string;
  description: string;
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
