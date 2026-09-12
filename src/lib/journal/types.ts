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
  /**
   * Where this entry came from: `""` written by hand, `"ics"` imported from an
   * iCalendar export, `"csv"` from the CSV importer. See migration 0088.
   */
  source: string;
  /**
   * The source's own id for this entry -- for `"ics"`, the VEVENT's UID. `""`
   * when the entry has no external identity. This is what makes re-importing
   * the same calendar export a no-op.
   */
  externalId: string;
  /**
   * The DESCRIPTION (plus any note prefix) the calendar importer last wrote into
   * `content`, verbatim — migration 0089.
   *
   * Lets a re-import tell the reader's own writing from the text it put there
   * itself: whatever of `content` is not this is theirs, and only this part is
   * replaced. `""` for a hand-written entry, and for anything imported before
   * 0089 — read as "all of the content is the reader's".
   */
  externalContent: string;
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
  /**
   * Absolute path to the photo archive the entry viewer looks in for pictures taken on
   * an entry's date. `""` means not configured, and the photo card says so.
   *
   * A setting rather than an env var because the two environments need different values
   * (a UNC path from Windows in dev, `/volume1/...` on the NAS) and an env var can only
   * be changed by editing a file on the box and restarting the app — which is exactly
   * how this went wrong the first time. Stored per-install in sys_module_settings, so
   * each environment holds its own and neither needs a redeploy to fix a typo.
   */
  photoRoot: string;
}

// --- Prefill templates -------------------------------------------------------
//
// A named set of field values a new entry can be started from. Stored as JSON in
// jrn_prefill_templates.fields_json; see migration 0062 for why that isn't a
// child table, and why `mode` exists.

/** The entry fields a template can prefill. Deliberately narrower than the entry:
 *  locations and weather are excluded because the form already resolves both live
 *  from GPS, and a stored copy would be staler than one button press. */
export type JournalPrefillField =
  | "date"
  | "time"
  | "title"
  | "content"
  | "placeName"
  | "categories"
  | "tags";

/**
 * How a field's value is produced when the template is applied.
 *
 * `literal` uses `value` as typed. `now` resolves to the current date or time at
 * apply-time and is legal **only** on `date` and `time` — a stored literal date
 * would pin every new entry to a fixed day in the past.
 */
export type JournalPrefillMode = "literal" | "now";

/** One field of a template. `value` is "" whenever `mode` is `now`. */
export interface JournalPrefillFieldValue {
  field: JournalPrefillField;
  mode: JournalPrefillMode;
  value: string;
}

/** A named template as stored. */
export interface JournalPrefillTemplate {
  id: number;
  name: string;
  description: string;
  /** Disabled templates stay on the Templates screen but leave the entry form's
   *  dropdown. See 0062. */
  isEnabled: boolean;
  fields: JournalPrefillFieldValue[];
  createdAt: string;
  updatedAt: string;
}

/**
 * The subset of the New Entry form a template can fill. Plain strings throughout,
 * matching what the form's inputs hold — categories and tags are the delimited
 * text the form collects (comma / whitespace), not arrays, so applying a template
 * is a straight string set with no parsing in the view.
 */
export type JournalPrefillFormValues = Record<JournalPrefillField, string>;

/**
 * An entry sitting in the recycle bin (migration 0079).
 *
 * Extends the entry shape rather than replacing it so the registered
 * `JournalViewer` can render a recycled entry unchanged — the Recycled Entries
 * card opens the same viewer the calendar does. `id` is therefore the *original*
 * entry id, the one the viewer and its links expect.
 *
 * The bin's own row id is `recycledId`, which is what every recycle-bin
 * operation (restore, purge) is keyed on. Keeping the two apart matters: the
 * same original entry can be recycled, restored and recycled again, so
 * `recycledId` is unique here and `id` is not.
 */
export interface RecycledJournalEntry extends JournalEntry {
  /** `jrn_recycled_entries.id` — the handle for restore and purge. */
  recycledId: number;
  /** When it went into the bin. Orders the list, newest first. */
  deletedAt: string;
}

// --- Calendar (.ics) import --------------------------------------------------
//
// The shapes behind the Calendar Import section: a parsed calendar event, the
// filter that narrows a file's events down, the field presets applied to every
// imported one, and the plan shown before anything is written.
//
// Recurrence is reported, never expanded: a recurring series exports as one
// VEVENT and imports as one entry. `IcsEvent.isRecurring` exists so the UI can
// say that out loud.

/** One VEVENT, reduced to what a journal entry can be built from. */
export interface IcsEvent {
  /** The VEVENT's UID. `""` if the file omitted it — see `IcsImportPlanRow`. */
  uid: string;
  /** SUMMARY — becomes the entry's title. */
  summary: string;
  /** DESCRIPTION — becomes the entry's content. */
  description: string;
  /** LOCATION — becomes the entry's place name, unless a preset overrides it. */
  location: string;
  /** DTSTART's date, YYYY-MM-DD. */
  date: string;
  /** DTSTART's time, HH:MM. `""` for an all-day event. */
  time: string;
  isAllDay: boolean;
  /** DTEND's date, or `""` when the event had no DTEND. */
  endDate: string;
  /** DTEND's time, or `""`. */
  endTime: string;
  /** True when the VEVENT carried an RRULE, so only its first occurrence imports. */
  isRecurring: boolean;
  /** X-WR-CALNAME from the file, or `""`. Same for every event in one file. */
  calendarName: string;
}

/**
 * How the wizard's step 2 narrows a file down. Every field is optional and they
 * combine with AND — an empty filter matches every event.
 */
export interface IcsImportFilter {
  /** Inclusive lower bound on the event date, YYYY-MM-DD. `""` = unbounded. */
  fromDate?: string;
  /** Inclusive upper bound, YYYY-MM-DD. `""` = unbounded. */
  toDate?: string;
  /** Case-insensitive substring the summary must contain. `""` = no constraint. */
  summaryContains?: string;
  /** Case-insensitive substring the summary must NOT contain. */
  summaryExcludes?: string;
  /** When true, drop events with an empty SUMMARY — they'd import untitled. */
  requireSummary?: boolean;
  /** When false, drop all-day events, keeping only timed ones. Default true. */
  includeAllDay?: boolean;
}

/**
 * The fields applied to every imported entry, set once in the wizard's step 3.
 *
 * Categories and tags are *added* to every entry. `placeName` is an override:
 * when non-empty it replaces the event's LOCATION, which is the escape hatch
 * for a calendar whose location field holds a full postal address.
 */
export interface IcsImportPresets {
  categories: string[];
  tags: string[];
  /** Replaces LOCATION when non-empty. */
  placeName?: string;
  /** Prepended to the event's DESCRIPTION as the entry's content, if set. */
  notePrefix?: string;
  /**
   * On an event already imported, keep the fields the reader owns rather than
   * replacing the whole entry (migration 0089). Default **true**.
   *
   * The calendar's own fields (title, date, time, place) are overwritten either
   * way. What this protects is the reader's half of `content`, their pin and
   * lock, their weather and GPS points, and any category or tag they added by
   * hand — those merge with the presets instead of being replaced.
   *
   * `false` restores the pre-0089 behaviour: a matched event is replaced whole.
   */
  preserveLocalEdits?: boolean;
}

/** What an import would do with one event. */
export type IcsImportAction = "create" | "update" | "skip";

/** One event's resolution, shown in the selection table before the import runs. */
export interface IcsImportPlanRow {
  /** Index into the *filtered* event list — the selection key. */
  eventIndex: number;
  action: IcsImportAction;
  /** The entry this row would overwrite. Set only when `action` is "update". */
  entryId?: number;
  /** The event itself, for display. */
  event: IcsEvent;
  /** Why this row will be skipped. Set only when `action` is "skip". */
  blockedReason?: string;
}

export interface IcsImportPlan {
  rows: IcsImportPlanRow[];
  createCount: number;
  updateCount: number;
  skipCount: number;
}
