// The front door. Everything outside src/lib/music-magic imports from here and nowhere
// else, so the internals stay rearrangeable.

export {
  DEFAULT_TARGET_SECONDS,
  MAGIC_TARGET_PRESETS,
  emptyCriteria,
  formatRunningTime,
  hasAnyFilter,
  type GeneratedPlaylist,
  type MagicCriteria,
  type MagicGenerationStats,
  type MagicList,
  type MagicListSummary,
} from "./types";

export {
  MAX_TARGET_SECONDS,
  MIN_TARGET_SECONDS,
  generateMagicSchema,
  magicCriteriaSchema,
  magicFolderPathSchema,
  magicListIdSchema,
  magicListUpdateSchema,
  magicListWriteSchema,
  type MagicCriteriaInput,
  type MagicListUpdateInput,
  type MagicListWriteInput,
} from "./schema";

export {
  describeGeneration,
  selectTracksForTarget,
  spaceOutTracks,
} from "./generate";

export {
  folderLabel,
  folderLikePattern,
  folderParent,
  isFolderWithin,
  pruneRedundantFolders,
} from "./folders";

// `shuffle` and `RandomSource` live in @/lib/shared/random now that the play queue shuffles
// too -- re-exported here so this module's public surface is unchanged for its callers.
export { shuffle, type RandomSource } from "@/lib/shared/random";

export {
  countMagicCandidates,
  deleteMagicList,
  describeMagicFailure,
  generateMagicPlaylist,
  listMagicFolderOptions,
  listMagicLists,
  listMagicPickerOptions,
  loadMagicList,
  regenerateMagicList,
  saveMagicList,
  updateMagicList,
  type MagicDependencies,
  type MagicFailure,
  type MagicResult,
} from "./magic";

export type {
  MagicAlbumOption,
  MagicCandidateSource,
  MagicFolderOption,
  MagicListRepository,
  MagicPickerOption,
} from "./ports";

// The SQLite adapters are NOT re-exported here, for the same reason src/lib/music/index.ts
// withholds its own: this barrel is imported by client components for types and the target
// presets, and repository.ts pulls in better-sqlite3. Re-exporting it puts a native addon
// in the browser bundle's module graph, which Turbopack fails the build on.
//
// wiring.ts imports it from its own path instead:
//
//   import { SqliteMagicCandidateSource, SqliteMagicListRepository } from "@/lib/music-magic/repository";
