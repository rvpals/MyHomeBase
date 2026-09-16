import { z } from "zod";

/**
 * The admin screen's boundary: which components are enabled.
 *
 * The ids are enumerated rather than left as `z.string()` so an unknown one is rejected
 * at the boundary instead of being written and silently dropped on the next read. Adding
 * a floating component means adding it here as well as to `FLOATING_COMPONENTS` — the
 * one place the registry isn't the single source, and the type error if you forget is
 * the point.
 *
 * No `.catch`: an admin screen posting an id this build doesn't know is a bug in the
 * caller, and quietly correcting it would hide which switch failed to save.
 */
export const enabledFloatingSchema = z.array(z.enum(["clock", "calculator", "scratchpad"]));

export type EnabledFloatingInput = z.infer<typeof enabledFloatingSchema>;
