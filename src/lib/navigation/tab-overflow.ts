// Which module tabs are drawn in the row, and which fall into the overflow menu.
//
// The full layout's `horizontal` shape puts modules in a tab row, and twelve of
// them do not fit one row at any realistic width. Something has to choose. This
// file is that choice, kept here as a pure function so the decision is testable
// without a DOM: `NavTabs` measures, this decides, `NavTabs` draws.
//
// **The active module is always visible**, whatever the measurement says. A tab
// row whose highlighted tab is hidden inside "More" is a navigation surface that
// has lost track of where you are — the same failure `resolveInitialExpanded`
// guards against in the tree, and the reason that rule lives in both files.
//
// Order is the caller's: `sequence` from the module registry, which an admin can
// already change under Module Configuration. Nothing here re-sorts, because a
// reader who put Journal first expects Journal first, and a tab row that reorders
// itself by use is a row whose tabs move while you are aiming at one.

/** The least a tab row may show before the row is pointless. */
const MIN_VISIBLE_TABS = 1;

/**
 * A module, as this splitter needs it: a slug to match the active one against,
 * and nothing else. Deliberately minimal — the full nav type carries a name,
 * sections and icons this decision never reads.
 *
 * **Only `slug`**, on purpose. An earlier version also required a `label`, which
 * `TreeModule` spells `name`: the constraint then failed to bind, every caller
 * silently degraded to this type, and the tab row lost the fields it draws with.
 * Constrain on what the function actually reads, so `T` keeps the caller's own
 * type and the rest of its fields survive the round trip.
 */
export interface TabCandidate {
  slug: string;
}

export interface TabSplit<T extends TabCandidate> {
  /** Drawn in the row, in the caller's order. */
  visible: T[];
  /** Behind the "More" menu, in the caller's order. */
  overflow: T[];
}

/**
 * Split modules into the tabs that fit and the ones that don't.
 *
 * `capacity` is how many tabs the measured row can hold — `NavTabs` computes it
 * from a `ResizeObserver` and the tabs' own widths. It is clamped rather than
 * trusted: a zero or negative capacity (a row measured before layout, a hidden
 * container) still yields one tab rather than an empty row that looks broken.
 *
 * When the active module would have overflowed, it is **swapped into the last
 * visible slot** rather than prepended — prepending would shift every other tab
 * sideways as the reader navigates, so tabs would never sit still.
 */
export function splitTabs<T extends TabCandidate>(
  modules: readonly T[],
  capacity: number,
  activeSlug?: string,
): TabSplit<T> {
  if (modules.length === 0) return { visible: [], overflow: [] };

  // A row that can hold everything needs no menu and no swapping.
  if (capacity >= modules.length) return { visible: [...modules], overflow: [] };

  const slots = Math.max(MIN_VISIBLE_TABS, Math.floor(capacity));
  const visible = modules.slice(0, slots);
  const overflow = modules.slice(slots);

  const activeIndex = activeSlug
    ? overflow.findIndex((module) => module.slug === activeSlug)
    : -1;

  // The active module fits already, or there is none — nothing to rescue.
  if (activeIndex === -1) return { visible, overflow };

  // Swap it with the last visible tab, so the active tab is always on screen and
  // the displaced one takes its place in the menu rather than vanishing.
  const displaced = visible[visible.length - 1];
  visible[visible.length - 1] = overflow[activeIndex];
  overflow[activeIndex] = displaced;

  return { visible, overflow };
}
