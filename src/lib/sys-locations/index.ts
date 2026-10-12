// The public surface of the application-wide saved-location library. Import
// from here, never from a file inside this folder.
//
// Grew out of the journal's own location library (migration 0140), minus
// everything that read jrn_entry_* tables: the importer, the "which entries use
// this?" list, and the entry repoint on merge. That library was retired by
// migration 0141.

export type {
  LocationCategory,
  LocationTag,
  LocationTaxonomyCount,
  LocationTaxonomyIcon,
  LocationTaxonomyKind,
  SavedLocation,
  SavedLocationWithUsage,
} from "./types";

export type { SavedLocationRepository } from "./ports";

export {
  locationSearchInputSchema,
  mergeLocationsInputSchema,
  promoteLocationInputSchema,
  saveLocationInputSchema,
  savedLocationSchema,
  updateLocationInputSchema,
  upsertLocationTaxonomyInputSchema,
  type LocationSearchInput,
  type MergeLocationsInput,
  type PromoteLocationInput,
  type SaveLocationInput,
  type UpdateLocationInput,
  type UpsertLocationTaxonomyInput,
} from "./schema";

export {
  MAX_LOCATION_ICON_BYTES,
  clearLocationTaxonomyIcon,
  countLocationsByCategory,
  countLocationsByTag,
  createSavedLocation,
  deleteLocationTaxonomy,
  deleteSavedLocation,
  findLocationDuplicates,
  generateLocationTaxonomyIcon,
  generateMissingLocationTaxonomyIcons,
  getLocationTaxonomyIcon,
  getSavedLocation,
  listLocationCategories,
  listLocationTags,
  listSavedLocations,
  mergeSavedLocations,
  promoteToSavedLocation,
  saveLocationTaxonomy,
  searchSavedLocations,
  setLocationTaxonomyIcon,
  updateSavedLocation,
  type LocationIconFillSummary,
} from "./sys-locations";

export {
  DEFAULT_DISTANCE_METRES,
  DEFAULT_NAME_THRESHOLD,
  MAX_DISTANCE_METRES,
  MAX_NAME_THRESHOLD,
  MIN_DISTANCE_METRES,
  MIN_NAME_THRESHOLD,
  arePlacesNear,
  countDuplicateLocations,
  findLocationDuplicateGroups,
  nameSimilarity,
  neighbourKeys,
  normalizeLocationName,
  type DuplicateLocation,
  type DuplicateScanOptions,
  type LocationDuplicateGroup,
} from "./dedup";

export {
  findDuplicateLocationIndex,
  isDuplicateLocation,
  type LocationPoint,
} from "./duplicate-in-list";

export { SqliteSavedLocationRepository } from "./repository";
