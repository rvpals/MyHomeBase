import type { DeploymentRepository } from "./ports";
import { deploymentBuildLogSchema, deploymentIdSchema } from "./schema";
import type { Deployment, DeploymentBuildLog, RecordDeploymentInput } from "./types";

// The deployment history: what deployed, when, and what its build printed.
//
// The unusual thing about this module is that its writer and its reader run on different
// machines. `scripts/record-deployment.ts` calls `recordDeployment` on the deployment
// target as the new build comes up; the About screen calls `listDeployments` from the
// running app. Nothing here knows that — it is all data in, data out — but it explains why
// `parseBuildLog` is so forgiving and why `recordDeployment` cannot throw on bad input.

/** Every recorded deployment, newest first. */
export function listDeployments(repo: DeploymentRepository): Deployment[] {
  return repo.list();
}

/**
 * Reads a shipped `build-log.json`.
 *
 * Returns `null` for anything unusable — absent file, invalid JSON, a JSON scalar or array
 * where an object was expected. Never throws: the caller is a deploy step that must record
 * the deployment regardless, so "I could not read the log" has to be a value it can carry
 * on with, not an exception that skips the insert.
 *
 * `text` is `null` when the file wasn't there at all, which is the normal case for a
 * package built before this feature existed.
 */
export function parseBuildLog(text: string | null): DeploymentBuildLog | null {
  if (text === null || text.trim() === "") return null;

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }

  // A valid-JSON scalar or array parses fine but is not a build log. zod would reject it
  // anyway; checking here keeps the failure one shape ("not a log") rather than two.
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;

  const result = deploymentBuildLogSchema.safeParse(raw);
  if (!result.success) return null;

  // `.nullish()` admits undefined; the database wants null. Normalise once here so the
  // repository never has to think about the difference.
  const parsed = result.data;
  return {
    buildId: parsed.buildId ?? null,
    appVersion: parsed.appVersion ?? null,
    builtAt: parsed.builtAt ?? null,
    builtOnHost: parsed.builtOnHost ?? null,
    nodeAbi: parsed.nodeAbi ?? null,
    packageSizeBytes: parsed.packageSizeBytes ?? null,
    // Already clamped to MAX_BUILD_OUTPUT_LENGTH by the schema's transform.
    output: parsed.output ?? null,
  };
}

/**
 * Records a deployment, returning the new row's id.
 *
 * `deployedAt` is a parameter rather than `new Date()` so this stays a pure function of its
 * inputs and the test doesn't need a clock. It is stamped by the caller on the deployment
 * target, which makes it the moment the build went live rather than the moment it was
 * built — see migrations/0078_create_deployments.md.
 */
export function recordDeployment(
  repo: DeploymentRepository,
  input: RecordDeploymentInput,
): number {
  const { buildLog, migrated, deployedAt } = input;
  return repo.record({
    deployedAt: deployedAt.toISOString(),
    builtAt: buildLog?.builtAt ?? null,
    buildId: buildLog?.buildId ?? null,
    appVersion: buildLog?.appVersion ?? null,
    builtOnHost: buildLog?.builtOnHost ?? null,
    nodeAbi: buildLog?.nodeAbi ?? null,
    packageSizeBytes: buildLog?.packageSizeBytes ?? null,
    migrated,
    buildOutput: buildLog?.output ?? null,
  });
}

/**
 * Deletes one deployment record.
 *
 * Throws on a malformed id (not a positive integer) — that's a broken caller. Returns
 * `false` for a well-formed id that matched nothing, which is not an error: the row may
 * have been deleted in another tab, or on the phone a moment ago.
 */
export function deleteDeployment(repo: DeploymentRepository, id: unknown): boolean {
  return repo.delete(deploymentIdSchema.parse(id));
}
