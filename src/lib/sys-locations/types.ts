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
  /**
   * How many rows elsewhere point at this one.
   *
   * Always 0 for now: nothing references `sys_locations` yet. Kept on the type
   * so the screens copied from the journal keep their shape, and so there is
   * one obvious place to fill in when a module starts using these places.
   */
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
// --- Referencing these places from a module -----------------------------------
//
// Nothing here describes a module's rows. Shapes built around one module's
// tables do not belong in an application-wide library -- depending on them is
// what `sys_` exists to avoid.
//
// A module that starts referencing these places brings its own equivalents.
