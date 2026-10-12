import type {
  LocationSearchCriteria,
  LocationTaxonomyWriteData,
  LocationWriteData,
} from "./schema";
import type { DecodedImage } from "@/lib/shared/image-upload";
import type {
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
   * Folds `removeIds` into `keepId`: unions their category and tag links onto
   * the survivor, then deletes them.
   *
   * Returns how many rows elsewhere were repointed at the survivor, which is
   * always 0 — nothing references these places (migration 0141 dropped the
   * journal's provenance column with its library). The return is kept so the
   * screens reporting it keep their shape, and so there is one place to fill
   * in when a module starts using these places.
   *
   * Still one repository method rather than a loop in the use-case, because the
   * link union and the deletes have to be **one transaction**.
   */
  mergeLocations(keepId: number, removeIds: readonly number[]): number;

  // --- Provenance ----------------------------------------------------------
  //
  // There is none. An application-wide library that knew about one module's
  // tables would be the coupling `sys_` exists to avoid, so nothing here reads
  // or writes a module's rows.
  //
  // When a module starts referencing these places, the pointer lives on that
  // module's table and the reads come back as something it supplies.

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
