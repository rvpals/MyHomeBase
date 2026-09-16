export {
  deleteDeployment,
  deleteDeployments,
  listDeployments,
  parseBuildLog,
  pruneDeployments,
  recordDeployment,
} from "./deployments";
export {
  DEPLOYMENTS_KEEP_COUNT,
  MAX_BUILD_OUTPUT_LENGTH,
  TRUNCATION_MARKER,
  deploymentBuildLogSchema,
  deploymentIdListSchema,
  deploymentIdSchema,
  deploymentKeepCountSchema,
} from "./schema";
export type { DeploymentBuildLogInput } from "./schema";
export type { DeploymentRepository, NewDeploymentRow } from "./ports";
export type { Deployment, DeploymentBuildLog, RecordDeploymentInput } from "./types";

// `SqliteDeploymentRepository` is deliberately NOT re-exported, the same way
// FileChangeHistoryRepository and FileBuildIdRepository are not.
//
// The About view is a `"use client"` module and imports `Deployment` from this barrel. A
// re-export here would pull `better-sqlite3` along the barrel into the client bundle. It
// is wired in wiring.ts instead, and scripts/record-deployment.ts imports it by relative
// path (the NAS has no path-alias resolution).
