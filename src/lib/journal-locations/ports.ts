import type {
  LocationSearchCriteria,
  LocationTaxonomyWriteData,
  LocationWriteData,
} from "./schema";
import type { DecodedImage } from "@/lib/shared/image-upload";
import type {
  EntryLocationSource,
  LocationCategory,
  LocationTag,
  LocationTaxonomyCount,
  LocationTaxonomyIcon,
  SavedLocation,
  SavedLocationWithUsage,
} from "./types";

/**
 * The interface the saved-location use-cases depend on. The real SQLite
 * implementation is wired at `wiring.ts`; tests wire an in-memory fake.
 */
export interface SavedLocationRepository {
  // --- Places --------------------------------------------------------------

  /** Every saved place, name first then id, each with its usage count. */
  listLocations(): SavedLocationWithUsage[];

  getLocationById(id: number): SavedLocation | undefined;

  /**
   * The places matching `criteria`. Text is matched case-insensitively against
   * name, description and address; category and tag filters are AND-ed.
   *
   * Pushed down to the repository rather than filtered in the use-case because
   * the taxonomy filters are joins — doing it in TypeScript would mean reading
   * every location and both link tables on every keystroke of the picker.
   */
  searchLocations(criteria: LocationSearchCriteria): SavedLocationWithUsage[];

  /** Writes the place and its category/tag links in one transaction. */
  createLocation(input: LocationWriteData): SavedLocation;

  /** Same, replacing the links wholesale. Throws if `id` is unknown. */
  updateLocation(id: number, input: LocationWriteData): SavedLocation;

  /**
   * Deletes the place and its links. Entry locations copied from it keep their
   * coordinates and are detached (`saved_location_id` → NULL) by the schema's
   * ON DELETE SET NULL, not by this method.
   */
  deleteLocation(id: number): void;

  /** How many entry locations were copied from this place. */
  countUsage(id: number): number;

  /**
   * Folds `removeIds` into `keepId`: repoints every entry location pointing at
   * a removed place, unions their category and tag links onto the survivor,
   * then deletes them. Returns how many entry locations moved.
   *
   * One repository method rather than a loop of `linkEntryLocation` +
   * `deleteLocation` in the use-case, because it has to be **one transaction**.
   * A delete that lands without its repoint is not a slower merge, it is the
   * silent data loss `ON DELETE SET NULL` is designed to cause — the entries
   * keep their coordinates but stop pointing at any library row, and nothing
   * on screen would say so.
   */
  mergeLocations(keepId: number, removeIds: readonly number[]): number;

  // --- Provenance ----------------------------------------------------------

  /**
   * Points an existing `jrn_entry_locations` row at a library row.
   *
   * The one method here that touches a table `lib/journal` owns. It lives on
   * this side because the column is provenance *into* the library and nothing
   * in the journal's own reads or writes consults it — see migration 0101.
   */
  linkEntryLocation(entryLocationId: number, savedLocationId: number): void;

  // --- Importing from existing entries -------------------------------------

  /**
   * Every location already on a journal entry, with that entry's `place_name`.
   *
   * The second method here that reads a table `lib/journal` owns, for the same
   * reason as `linkEntryLocation`: the importer's whole job is to pull those
   * rows into this library, and routing it through the journal's repository
   * would make two modules depend on each other.
   *
   * Returns *every* row rather than paging: grouping is done over the whole set
   * (a coordinate's most common name can't be known from a page), and a journal
   * with tens of thousands of locations is still a few MB of numbers.
   */
  listEntryLocationsForImport(): EntryLocationSource[];

  /** Every saved place's coordinates, for skipping candidates already held. */
  listLocationCoordinates(): { latitude: number; longitude: number }[];

  // --- Taxonomy ------------------------------------------------------------

  listCategories(): LocationCategory[];
  getCategoryByName(name: string): LocationCategory | undefined;
  upsertCategory(input: LocationTaxonomyWriteData): LocationCategory;
  /** Removes the category and every pairing that used it. */
  deleteCategory(name: string): void;
  /** Category names with how many places carry each, for the filter UI. */
  countLocationsByCategory(): LocationTaxonomyCount[];
  /** The icon bytes. Only the icon-serving route calls this — never a list read. */
  getCategoryIcon(name: string): LocationTaxonomyIcon | undefined;
  /** Stores or, with `undefined`, removes the category's icon. */
  setCategoryIcon(name: string, icon: DecodedImage | undefined): void;

  listTags(): LocationTag[];
  getTagByName(name: string): LocationTag | undefined;
  upsertTag(input: LocationTaxonomyWriteData): LocationTag;
  deleteTag(name: string): void;
  countLocationsByTag(): LocationTaxonomyCount[];
  getTagIcon(name: string): LocationTaxonomyIcon | undefined;
  setTagIcon(name: string, icon: DecodedImage | undefined): void;
}
