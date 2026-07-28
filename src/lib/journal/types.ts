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
