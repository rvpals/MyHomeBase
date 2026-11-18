import { z } from "zod";
import { photoRelativePathSchema } from "@/lib/journal-photos/schema";

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
