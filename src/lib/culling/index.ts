// The public surface of the culling module. Import from here, never from a file
// inside it.
//
// Ranks a folder of photographs so the best ones can be found without opening all of
// them: each image is measured for sharpness, exposure and contrast, ranked against
// the others in the same folder, and grouped with its near-duplicates so a burst
// contributes one picture rather than twenty.
//
// READ-ONLY THROUGHOUT. Culling produces a ranking and nothing else -- it never
// deletes a reject, moves a keeper, or writes anything into the archive. See
// `ports.ts`.
//
// Folders are addressed relative to the archive root (`"2019/2019-06"`), the same way
// every other photo module addresses them, and validated with the journal's
// `isSafeRelativePath` guard.

export {
  CULLING_CONFIG,
  DEFAULT_CULL_IMAGES,
  MAX_CULL_CEILING,
  MIN_CULL_IMAGES,
  SUPPORTED_EXTENSIONS,
  UNSUPPORTED_EXTENSIONS,
  type CullingConfig,
} from "./config";

export type {
  AnalysisFailure,
  AnalyzedPhoto,
  CullOptions,
  CullPathsResult,
  CullResult,
  GrayscaleImage,
  PhotoMetrics,
  RejectReason,
  RejectedPhoto,
  ScoredPhoto,
  UnreadablePhoto,
} from "./types";

export type { CullingImageStore } from "./ports";

export { cullFolder, MAX_CULL_IMAGES, reachVerdicts } from "./cull";

// The cross-folder counterpart, for a set assembled by hand or drawn from the whole
// archive -- an album or a Magic List. Shares every judgement with `cullFolder`.
export { cullPhotoPaths } from "./cull-paths";

export {
  CULLING_MODULE_SLUG,
  CULLING_SETTING_KEYS,
  cullingSettingsToEntries,
  resolveCullingSettings,
  type CullingSettings,
} from "./settings";

export { cullRequestSchema, type CullRequestInput } from "./schema";

export { analyzeImage } from "./analyze";

export {
  centerCrop,
  clippedFraction,
  laplacianVariance,
  luminanceStats,
  measure,
} from "./metrics";

export { DHASH_HEIGHT, DHASH_WIDTH, differenceHash, hammingDistance } from "./dhash";

export {
  describeScore,
  exposurePenalty,
  percentileRanks,
  scoreBatch,
  sortByScore,
} from "./score";

export { groupDuplicates, type DuplicateGroup } from "./group";

export { NodeCullingImageStore } from "./file-store";

// Resolved here rather than in the app layer so the CLI and any future caller
// share one answer to "which folder are we reading".
export { configuredCullCeiling, configuredPhotoRoot } from "./photo-root";

