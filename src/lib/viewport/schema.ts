import { z } from "zod";

/**
 * Validates a stored viewport value.
 *
 * The cookie is user-editable, so it is parsed rather than cast. Callers use
 * `safeParse` and fall back to a guess — a junk value should cost a slightly
 * wrong first paint, not a crash on every page.
 */
export const viewportSchema = z.enum(["compact", "full"]);

export type ViewportInput = z.infer<typeof viewportSchema>;
