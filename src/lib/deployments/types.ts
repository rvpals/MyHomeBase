// One recorded deployment, as read back from `sys_deployments`.
//
// Almost everything is nullable because almost everything comes from the build log that
// travelled with the package, and that file can be missing (see
// migrations/0078_create_deployments.md). A row is still a valid record with nothing but
// its timestamp — the view renders the unknowns as an em dash rather than hiding the row.
export interface Deployment {
  id: number;
  /** ISO 8601. When the build went live, stamped on the machine running it. */
  deployedAt: string;
  /** ISO 8601. When the package was built, which is earlier and on a different machine. */
  builtAt: string | null;
  /** `.next/BUILD_ID` — the same string the About screen shows for the running build. */
  buildId: string | null;
  /** `package.json` version at build time. */
  appVersion: string | null;
  /** Hostname of the machine that ran the build. */
  builtOnHost: string | null;
  /** Node ABI the native modules were fetched for, e.g. 127. */
  nodeAbi: number | null;
  packageSizeBytes: number | null;
  /** Whether pending migrations were applied as part of this deployment. */
  migrated: boolean;
  /** Captured console output of the build, verbatim. */
  buildOutput: string | null;
}

/**
 * The contents of `build-log.json`, written into the package by
 * `scripts/publish-nas.mjs` and read on the target by `scripts/record-deployment.ts`.
 *
 * This is a wire format between two machines and two processes, so it is validated on
 * read rather than trusted — `deploymentBuildLogSchema` is the single source of truth for
 * the shape, and every field is optional there for the same reason it is nullable here.
 */
export interface DeploymentBuildLog {
  buildId: string | null;
  appVersion: string | null;
  builtAt: string | null;
  builtOnHost: string | null;
  nodeAbi: number | null;
  packageSizeBytes: number | null;
  output: string | null;
}

/** What `recordDeployment` needs to write a row. */
export interface RecordDeploymentInput {
  /** The build log that shipped with the package, or `null` when there wasn't one. */
  buildLog: DeploymentBuildLog | null;
  /** Whether this deployment applied migrations. */
  migrated: boolean;
  /** The go-live moment. Passed in rather than read from the clock so this stays pure. */
  deployedAt: Date;
}
