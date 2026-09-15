// The front door. Everything outside src/lib/photo-magic imports from here and nowhere
// else, so the internals stay rearrangeable.
//
// A Magic List is a saved SEARCH over the photo archive -- a date range, a file-size
// band, a resolution floor and a ceiling on how many pictures -- which draws a random
// set from an index of the archive's file facts. `@/lib/albums` is the other thing: a
// collection assembled by hand. See migrations/0093_create_photo_magic_lists.md.

export {
  DEFAULT_MAX_PHOTOS,
  MAX_LIST_PHOTOS,
  PHOTO_COUNT_PRESETS,
  RESOLUTION_PRESETS,
  emptyCriteria,
  formatBytes,
  formatResolution,
  hasAnyFilter,
  hasResolutionFilter,
  isScanRunStale,
  scanProgressPercent,
  type GeneratedPhotoSet,
  type IndexedPhoto,
  type MagicScanRun,
  type PhotoFileFacts,
  type PhotoMagicCriteria,
  type PhotoMagicList,
  type PhotoMagicListSummary,
  type PhotoMagicStats,
  type ScanRunProgress,
  type ScanStatus,
} from "./types";

export {
  generatePhotoMagicSchema,
  photoMagicCriteriaSchema,
  photoMagicListIdSchema,
  photoMagicListUpdateSchema,
  photoMagicListWriteSchema,
  scanRangeSchema,
  type GeneratePhotoMagicInput,
  type PhotoMagicCriteriaInput,
  type PhotoMagicListUpdateInput,
  type PhotoMagicListWriteInput,
  type ScanRangeInput,
} from "./schema";

export { describeCriteria, matchesDateRange } from "./criteria";

export { describeGeneration, selectPhotos } from "./select";

export {
  scanPhotoIndex,
  type IndexScanDependencies,
  type IndexScanOptions,
  type IndexScanSummary,
} from "./index-scan";

export {
  canStartScan,
  clearPhotoIndex,
  countIndexedPhotos,
  countPhotoMagicCandidates,
  deletePhotoMagicList,
  describePhotoMagicFailure,
  generatePhotoMagicList,
  getScanStatus,
  listPhotoMagicLists,
  loadGeneratedPhotos,
  loadPhotoMagicList,
  matchesCriteria,
  regeneratePhotoMagicList,
  savePhotoMagicList,
  updatePhotoMagicList,
  type PhotoMagicDependencies,
  type PhotoMagicFailure,
  type PhotoMagicResult,
} from "./magic";

export type {
  MagicScanRunRepository,
  PhotoIndexRepository,
  PhotoMagicListRepository,
} from "./ports";

// `shuffle` and `RandomSource` come from @/lib/shared/random -- re-exported here so a
// caller driving a generation has one import for everything it needs.
export { shuffle, type RandomSource } from "@/lib/shared/random";

// The SQLite adapters are NOT re-exported here, for the same reason
// src/lib/music-magic/index.ts withholds its own: this barrel is imported by client
// components for types and presets, and repository.ts pulls in better-sqlite3.
// Re-exporting it puts a native addon in the browser bundle's module graph, which
// Turbopack fails the build on.
//
// wiring.ts imports them from their own path instead:
//
//   import {
//     SqliteMagicScanRunRepository,
//     SqlitePhotoIndexRepository,
//     SqlitePhotoMagicListRepository,
//   } from "@/lib/photo-magic/repository";
