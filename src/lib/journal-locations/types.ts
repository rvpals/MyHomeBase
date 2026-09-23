// Domain models for the Journal's saved-location library (migration 0101).
//
// Its own library module rather than a corner of `lib/journal`: it owns its own
// tables, repository and use-cases, and depends on nothing in `journal` — the
// coupling runs the other way, when an entry copies a location out of here.

/** One saved place. The library row; an entry's location is a copy of one. */
export interface SavedLocation {
  id: number;
  /**
   * The label the reader picks this place by. May be `""` — an address-only row
   * is still findable, and the manager falls back to showing the coordinates.
   */
  name: string;
  latitude: number;
  longitude: number;
  /** The reader's own words. Searched alongside `address` and `name`. */
  description: string;
  /** Usually reverse-geocoded from the pin, always editable by hand. */
  address: string;
  /** Category names, referencing LocationCategory.name. */
  categories: string[];
  /** Tag names, referencing LocationTag.name. */
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * A saved location with the number of entry locations copied from it.
 *
 * Separate from `SavedLocation` because the count needs a join the plain reads
 * don't: the picker and the map want places, the manager grid wants places plus
 * "used 4 times", and paying for that join on every read would be waste.
 */
export interface SavedLocationWithUsage extends SavedLocation {
  /** How many rows in `jrn_entry_locations` point at this one. */
  usageCount: number;
}

/**
 * A place category — what the *place* is ("Restaurant", "Trailhead").
 *
 * Deliberately a different list from the Journal's entry categories, which say
 * what the *writing* is about. See migration 0101's log.
 */
export interface LocationCategory {
  name: string;
  description: string;
  /**
   * Mime type of the category's icon, or undefined when none is set. The bytes
   * themselves are fetched separately (see LocationTaxonomyIcon) so they never
   * travel with a category list.
   */
  iconMimeType?: string;
  createdAt: string;
  updatedAt: string;
}

/** A place tag. Same shape as LocationCategory. */
export interface LocationTag {
  name: string;
  description: string;
  /** Same deal as LocationCategory.iconMimeType, for a tag's icon. */
  iconMimeType?: string;
  createdAt: string;
  updatedAt: string;
}

/** Raw icon bytes for one location category or tag, read only by the icon routes. */
export interface LocationTaxonomyIcon {
  data: Buffer;
  mimeType: string;
}

/** One taxonomy name and how many saved locations carry it. */
export interface LocationTaxonomyCount {
  name: string;
  count: number;
}

/** Which taxonomy list a use-case is acting on. */
export type LocationTaxonomyKind = "category" | "tag";

// --- Importing from existing entries -----------------------------------------
//
// The Location Manager can build the library out of the coordinates already
// sitting on journal entries. These are the shapes that job passes around.

/**
 * One location row already on an entry, plus the entry's own `place_name`.
 *
 * A flat read shaped for the importer rather than the `EntryLocation` domain
 * type from `lib/journal`: this module must not depend on that one (the
 * coupling runs the other way), and the importer needs a field — `placeName` —
 * that lives on the parent entry, not the location.
 */
export interface EntryLocationSource {
  /** The `jrn_entry_locations` row id, so a created place can be linked back. */
  entryLocationId: number;
  latitude: number;
  longitude: number;
  /** The location's own name, which becomes the candidate's name. */
  locationName: string;
  /** The owning entry's `place_name`, which becomes the description. */
  placeName: string;
}

/** One distinct place the importer proposes to create. */
export interface ImportCandidate {
  /** The coordinate key it was grouped under. Stable within one run. */
  key: string;
  latitude: number;
  longitude: number;
  name: string;
  description: string;
  /** Every entry-location row feeding this candidate, to link back on create. */
  entryLocationIds: number[];
  /** How many of those there are — what the manager shows as the usage count. */
  sourceCount: number;
}

/** What one batch of the import did, so the caller can move a progress bar. */
export interface ImportBatchResult {
  /** Candidates handled by this batch (not necessarily all created). */
  processedCount: number;
  /** Places actually written. */
  createdCount: number;
  /** How many of those came back with an address from the geocoder. */
  addressCount: number;
  /** Candidates still waiting after this batch. */
  remainingCount: number;
}
