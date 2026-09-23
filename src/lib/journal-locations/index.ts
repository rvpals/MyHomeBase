// The public surface of the Journal's saved-location library. Import from here,
// never from a file inside this folder.

export type {
  EntryLocationSource,
  ImportBatchResult,
  ImportCandidate,
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
} from "./journal-locations";

export {
  DEFAULT_NAME_THRESHOLD,
  MAX_NAME_THRESHOLD,
  MIN_NAME_THRESHOLD,
  countDuplicateLocations,
  findLocationDuplicateGroups,
  nameSimilarity,
  normalizeLocationName,
  type DuplicateLocation,
  type LocationDuplicateGroup,
} from "./dedup";

export { buildImportCandidates, existingLocationKey } from "./import-from-entries";

export {
  countImportCandidates,
  listImportCandidates,
  runImportBatch,
  GEOCODE_INTERVAL_MS,
  GEOCODED_BATCH_SIZE,
  PLAIN_BATCH_SIZE,
} from "./import-run";

export { SqliteSavedLocationRepository } from "./repository";
