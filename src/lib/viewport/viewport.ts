// Deciding which layout to serve.
//
// Three signals, in strict order of trust:
//
//   1. What the reader chose by hand      (pinned — never overruled)
//   2. The measured viewport width        (the truth, but only known client-side)
//   3. The User-Agent's device type       (a guess, but the only thing available
//                                          on the very first request)
//
// The order matters because signal 3 is wrong more often than it looks. iPadOS
// Safari reports itself as a Mac. "Request Desktop Website" sends a desktop
// string from a phone. A narrow window on a real desktop is still a desktop.
// So the UA is used to render *something* sensible before any JavaScript has
// run, and is then corrected by measurement.
//
// Pure functions only — no cookies, no `window`, no framework. The middleware,
// the layout and the client corrector each supply what they know.

import { viewportSchema } from "./schema";
import { VIEWPORT_BREAKPOINT_PX, type Viewport } from "./types";

/** The honest answer, given a real measurement. */
export function viewportForWidth(width: number): Viewport {
  return width < VIEWPORT_BREAKPOINT_PX ? "compact" : "full";
}

/**
 * A first guess from the User-Agent, for the request that arrives before any
 * measurement exists.
 *
 * Tablets count as compact: they sit below the 1024 boundary in portrait, which
 * is the orientation most of them are read in. When that's wrong the width
 * corrector fixes it on mount.
 */
export function viewportFromUserAgent(deviceType: string | undefined): Viewport {
  return deviceType === "mobile" || deviceType === "tablet" ? "compact" : "full";
}

/**
 * The layout to render, from whatever the server knows.
 *
 * An unreadable cookie is treated as absent rather than as an error — it is
 * user-editable data on the way in, and a bad value should degrade to a guess,
 * not break every page.
 */
export function resolveViewport(input: {
  cookieValue?: string;
  deviceType?: string;
}): Viewport {
  const stored = viewportSchema.safeParse(input.cookieValue);
  if (stored.success) return stored.data;
  return viewportFromUserAgent(input.deviceType);
}

/**
 * What the client should correct the cookie to after measuring, or `undefined`
 * when it should leave well alone.
 *
 * Returning `undefined` for "no change" is what keeps the corrector from
 * writing a cookie and refreshing on every single page load; it only acts when
 * the server actually got it wrong.
 */
export function correctionForWidth(input: {
  current: Viewport;
  width: number;
  pinned: boolean;
}): Viewport | undefined {
  // A hand-picked layout outranks the measurement. Someone on a phone who asked
  // for the full layout means it, and must not be silently overridden a moment
  // later — that would make the toggle look broken.
  if (input.pinned) return undefined;

  const measured = viewportForWidth(input.width);
  return measured === input.current ? undefined : measured;
}
