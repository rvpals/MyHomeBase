// Which layout the app is serving.
//
// Deliberately **not** "phone" and "desktop". The value describes the layout,
// not a guess about the hardware — an iPad in portrait is 810px wide and wants
// the compact layout whatever it calls itself, and a half-width window on a
// 27" monitor wants it too. Naming it after the device would make both of those
// read as bugs.

export type Viewport = "compact" | "full";

/**
 * The one boundary in the app, in CSS pixels.
 *
 * 1024 because that is already `lg`, the breakpoint every side-by-side layout
 * here uses (the module section trees are `lg:flex-row`). Reusing it means
 * "narrow" and "compact layout" are the same idea, and `max-lg:` is the single
 * convention for styling the compact side — see design.md.
 */
export const VIEWPORT_BREAKPOINT_PX = 1024;

/** Holds the resolved layout. Read by the server on every request. */
export const VIEWPORT_COOKIE = "mhb_viewport";

/**
 * Present only when the reader chose a layout by hand.
 *
 * A separate cookie rather than a third value on the first, because "which
 * layout" and "who decided" are different questions: middleware and the width
 * corrector both need to know they must not overrule a person.
 */
export const VIEWPORT_PINNED_COOKIE = "mhb_viewport_pinned";
