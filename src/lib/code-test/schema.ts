import { z } from "zod";
import { photoRelativePathSchema } from "@/lib/journal-photos/schema";
import { DEPENDENCY_IDS } from "./dependency-checks";

/**
 * Input for `testServerResizeImage`: a path RELATIVE to the configured photo root.
 *
 * Reuses the archive's own path schema, so the traversal guard is the one the image
 * route uses. A full or arbitrary filesystem path is refused here.
 */
export const serverResizeTestSchema = z.object({
  relativePath: photoRelativePathSchema,
});

export type ServerResizeTestInput = z.infer<typeof serverResizeTestSchema>;

/**
 * Input for `runDependencyChecks`: which dependencies to test. Empty = all of them.
 * Only the known ids pass, so neither the card nor the CLI can name anything else.
 */
export const dependencyCheckSchema = z.object({
  ids: z.array(z.enum(DEPENDENCY_IDS)).max(DEPENDENCY_IDS.length).default([]),
});

export type DependencyCheckInput = z.infer<typeof dependencyCheckSchema>;
