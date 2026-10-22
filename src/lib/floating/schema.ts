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

/**
 * One puck's dragged position, the boundary for `saveFloatingPosition`.
 *
 * The id is enumerated for the same reason `enabledFloatingSchema` enumerates it: an
 * unknown one must be rejected here rather than written and silently dropped on the
 * next read.
 *
 * `.finite()` on both coordinates, and it is the whole point of validating these at
 * all. A drag handler computes `clientX - grabX`; if either side is ever NaN the
 * arithmetic propagates it silently, and a stored `NaN,NaN` would park the puck at the
 * CSS fallback on every page load with nothing to say why. Rejecting at the boundary
 * turns that into a failed save the caller can show.
 *
 * Deliberately **not** range-checked against a viewport. The server has no idea how big
 * the reader's screen is, and a position stored from a wider monitor is legitimate —
 * `clampPuckPosition` is what makes it safe at render time. Validating a range here
 * would reject the honest case and still not catch the dishonest one.
 */
export const floatingPositionSchema = z.object({
  id: z.enum(["clock", "calculator", "scratchpad"]),
  x: z.number().finite(),
  y: z.number().finite(),
});

export type FloatingPositionInput = z.infer<typeof floatingPositionSchema>;

/**
 * Forgetting one puck's position — the "Reset position" control on Account.
 *
 * Its own schema rather than reusing the one above with optional coordinates: "put it
 * back" and "put it here" are different requests, and a shared shape would make a
 * dropped x/y look like a reset instead of failing.
 */
export const floatingPositionResetSchema = z.object({
  id: z.enum(["clock", "calculator", "scratchpad"]),
});

export type FloatingPositionResetInput = z.infer<typeof floatingPositionResetSchema>;
