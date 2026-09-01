import { z } from "zod";

// Boundary schemas for the deployment history. Two very different boundaries, and they
// are strict in opposite directions on purpose.

/**
 * The id a delete is asked for. A positive integer — `sys_deployments.id` is
 * `INTEGER PRIMARY KEY AUTOINCREMENT`, so anything else is a malformed request rather
 * than a row that happens not to exist.
 */
export const deploymentIdSchema = z.coerce.number().int().positive();

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
