import { z } from "zod";

// Boundary schemas for the deployment history. Two very different boundaries, and they
// are strict in opposite directions on purpose.

/**
 * The id a delete is asked for. A positive integer — `sys_deployments.id` is
 * `INTEGER PRIMARY KEY AUTOINCREMENT`, so anything else is a malformed request rather
 * than a row that happens not to exist.
 */
export const deploymentIdSchema = z.coerce.number().int().positive();

/**
 * The ids a batch delete is asked for — the ticked checkboxes on the Deployments tab.
 *
 * Non-empty: "delete nothing" is a caller that shouldn't have called, not a no-op worth
 * reporting as a success. Each id goes through `deploymentIdSchema`, so one malformed
 * entry fails the whole request rather than being silently skipped — a batch that quietly
 * deleted a subset of what was ticked is worse than one that refused.
 */
export const deploymentIdListSchema = z.array(deploymentIdSchema).min(1);

/**
 * How many of the newest deployments a prune keeps.
 *
 * Zero is allowed and means "clear the history" — a real thing to want, and rejecting it
 * would only push the caller into passing every id instead. The upper bound is absent on
 * purpose: a keep count larger than the history simply deletes nothing.
 */
export const deploymentKeepCountSchema = z.coerce.number().int().nonnegative();

/**
 * How many of the newest deployments the About screen's "Clear old records" button keeps.
 *
 * Here rather than in the view because the CLI's `deployments prune` has to agree with the
 * button — two hard-coded fives that could drift apart is exactly the bug this avoids.
 */
export const DEPLOYMENTS_KEEP_COUNT = 5;

/** How much captured build output is stored. See `deploymentBuildLogSchema`. */
export const MAX_BUILD_OUTPUT_LENGTH = 200_000;

/** Appended to a build log that hit `MAX_BUILD_OUTPUT_LENGTH`, so the cut is visible. */
export const TRUNCATION_MARKER = "\n… truncated.";

/**
 * `build-log.json`, as read on the deployment target.
 *
 * **Lenient by design**, which is the opposite of how most schemas in this codebase are
 * written, so it is worth saying why. This file crossed a machine boundary: it was
 * written by a build on Windows and is being read on the NAS, possibly by a newer or
 * older `record-deployment.cjs` than the one that wrote it. Rejecting the whole file
 * because one field drifted would lose the deployment record entirely — and the record is
 * the thing we came for.
 *
 * So every field is optional and nulls through to the database, `.catch(null)` swallows a
 * wrong type per-field rather than failing the parse, and unknown keys are ignored (zod's
 * default). A build log from a future version with extra fields still reads cleanly here.
 *
 * The one hard limit is on `output`: it lands in a TEXT column that a page renders, so a
 * runaway build log is truncated rather than stored whole.
 */
export const deploymentBuildLogSchema = z.object({
  buildId: z.string().trim().min(1).nullish().catch(null),
  appVersion: z.string().trim().min(1).nullish().catch(null),
  builtAt: z.string().trim().min(1).nullish().catch(null),
  builtOnHost: z.string().trim().min(1).nullish().catch(null),
  nodeAbi: z.number().int().positive().nullish().catch(null),
  packageSizeBytes: z.number().int().nonnegative().nullish().catch(null),
  // Clamped by `.transform`, NOT rejected by `.max()`.
  //
  // A `.max()` here would fail the field, `.catch(null)` would swallow the failure, and a
  // large build log would arrive as no build log at all — losing the whole thing over its
  // length, which is the opposite of what the cap is for. Truncating keeps the beginning,
  // which is the part that says what was built.
  //
  // The marker is deliberate: a silently shortened log reads as a build that stopped early.
  output: z
    .string()
    .transform((text) =>
      text.length <= MAX_BUILD_OUTPUT_LENGTH
        ? text
        : `${text.slice(0, MAX_BUILD_OUTPUT_LENGTH - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`,
    )
    .nullish()
    .catch(null),
});

export type DeploymentBuildLogInput = z.infer<typeof deploymentBuildLogSchema>;
