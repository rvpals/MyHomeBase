import type { Deployment } from "./types";

/** The row `record` inserts. Snake-cased at the repository boundary, not here. */
export interface NewDeploymentRow {
  deployedAt: string;
  builtAt: string | null;
  buildId: string | null;
  appVersion: string | null;
  builtOnHost: string | null;
  nodeAbi: number | null;
  packageSizeBytes: number | null;
  migrated: boolean;
  buildOutput: string | null;
}

/**
 * Storage for the deployment history.
 *
 * Append-and-delete only: there is no update. A deployment is a historical fact, so the
 * only two things you can do to a record of one are write it when it happens and throw it
 * away when you no longer care.
 */
export interface DeploymentRepository {
  /** Every deployment, newest first — the order the About tab reads in. */
  list(): Deployment[];
  /** Inserts one deployment and returns its new id. */
  record(row: NewDeploymentRow): number;
  /**
   * Deletes one deployment by id.
   *
   * Returns whether a row was actually removed, so the caller can tell "deleted" from
   * "already gone" — two people on the About screen at once, or a double-tap on a phone,
   * must not surface as an error.
   */
  delete(id: number): boolean;
}
