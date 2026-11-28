// The public surface of the code-test module: experiments run from Administration ->
// Code Tester. Import from here, never from a file inside it.
//
// Each experiment is one use-case that returns a plain-text report, and never throws --
// "it failed, here is why" is a result. `runServerResizeSuite` runs all of them over one
// folder and is what the screen calls; the individual ones are exported for tests and for
// a future card that wants just one.
export type {
  CodeTestDeps,
  ImageLibInfo,
  ImageLibProbe,
  ImageMetadata,
  TimedPhotoReader,
} from "./ports";
export {
  dependencyCheckSchema,
  serverResizeTestSchema,
  type DependencyCheckInput,
  type ServerResizeTestInput,
} from "./schema";
export {
  DEPENDENCY_IDS,
  DEPENDENCY_LOG_SOURCE,
  DEPENDENCY_STATUS_ORDER,
  describeError,
  describeErrorFully,
  formatDependencyReport,
  formatMs,
  listDependencyChecks,
  runDependencyChecks,
  runDependencyProbe,
  worstStatus,
  type DependencyCheckDeps,
  type DependencyCheckLog,
  type DependencyCheckResult,
  type DependencyCheckSummary,
  type DependencyFact,
  type DependencyId,
  type DependencyProbe,
  type DependencyRecorder,
  type DependencyReport,
  type DependencyStatus,
  type DependencyStep,
  type RuntimeInfo,
} from "./dependency-checks";
export { createDependencyProbes, describeRuntime } from "./dependency-probes";
export {
  MAX_SCAN,
  pickTestPhotos,
  samplePhotos,
  type PickedPhotos,
  type ScannedPhoto,
} from "./pick-test-photos";
export {
  RESIZE_LONG_EDGES,
  testServerResizeImage,
  type ServerResizeTestDeps,
} from "./test-server-resize-image";
export {
  CONCURRENCY_LONG_EDGE,
  CONCURRENCY_WIDTHS,
  testResizeConcurrency,
} from "./test-resize-concurrency";
export { testThumbnailPaths } from "./test-thumbnail-paths";
export { CONCURRENCY_BATCH, runServerResizeSuite } from "./run-server-resize-suite";
export { SharpImageLibProbe, createTimedPhotoReader } from "./image-lib-probe";
