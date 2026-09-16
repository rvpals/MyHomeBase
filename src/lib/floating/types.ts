/**
 * The floating layer: components that live *over* the page rather than in it.
 *
 * A floating component has three states and they are genuinely three, not a boolean
 * pair — which is the whole reason this is a union rather than an `isOpen` flag:
 *
 * - `open`      the window card is up, over the page
 * - `minimized` shrunk to a small puck in a screen corner; still running
 * - `closed`    gone entirely, and only the reader's own Account screen brings it back
 *
 * `minimized` and `closed` are deliberately different. Minimizing is "get out of my way
 * for a moment" (the gesture `MusicPlayerBar` already models); closing is "I don't want
 * this". Collapsing them into one flag would mean a reader who dismissed the clock for a
 * minute finds it gone for good, or one who closed it keeps getting it back.
 */
export type FloatingState = "closed" | "minimized" | "open";

/**
 * The id of a floating component.
 *
 * A closed union, not `string`. These ids are persisted twice over — in the app-wide
 * enabled list and in each reader's own state rows — so a typo would silently create a
 * second, permanently-empty component rather than failing to compile.
 *
 * Adding one means an entry in `FLOATING_COMPONENTS` (registry.ts) and a case wherever
 * the layer renders it. See `registry.ts` for the full recipe.
 */
export type FloatingId = "clock" | "calculator" | "scratchpad";

/**
 * One floating component, as the data both the admin screen and the Account screen
 * render.
 *
 * A catalogue in `lib` rather than literals in a view, for the reason
 * `COMPACT_NAV_STYLES` gives: the label and the description are facts about the
 * component, not presentation, and the CLI prints the same list.
 */
export interface FloatingComponentInfo {
  id: FloatingId;
  /** What both screens call it. */
  label: string;
  /** One line on what it does, shown under the label. */
  description: string;
  /**
   * Whether it ships enabled for a household that has never visited the admin screen.
   *
   * Opt-*in* for everything so far: a floating window that appears unbidden over every
   * page after an upgrade is a worse first impression than one nobody has found yet.
   */
  enabledByDefault: boolean;
}

/**
 * Where a puck parks, resolved by `resolvePuckSlots`.
 *
 * An index rather than a pixel offset: `lib` has no business knowing how tall a puck is
 * or what the safe-area inset comes to. The CSS owns the arithmetic; this owns the
 * *order*. That split is what lets the stacking be unit-tested without a browser.
 */
export interface PuckSlot {
  id: FloatingId;
  /** 0 is nearest the corner; each step up sits one puck further away from it. */
  index: number;
  /** Which corner this puck is docked in — the reader's own choice. */
  corner: PuckCorner;
}

/**
 * Which screen corner a minimized puck docks in.
 *
 * A per-component reader preference. Four corners rather than a boolean pair because
 * the right answer depends on the reader's screen and hands: bottom-right is the
 * default (and where the music puck lives), but a right-handed phone user may want
 * bottom-left to keep a thumb clear of it, and a reader whose page has a tall bottom
 * bar may want a top corner instead.
 *
 * The **bottom** corners are the ones that have to share the edge with the compact
 * section trigger and the music player; the top corners are clear of both but sit
 * under the notch on an installed phone, which is why `env(safe-area-inset-top)` is
 * part of their offset. See `.floating-puck` in `globals.css`.
 */
export type PuckCorner = "bottom-right" | "bottom-left" | "top-right" | "top-left";

/** One corner, as the data the preference UI renders. */
export interface PuckCornerInfo {
  id: PuckCorner;
  /** What the Account screen calls it. */
  label: string;
}
