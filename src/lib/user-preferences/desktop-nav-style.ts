import type { DesktopNavStyle } from "./types";

/**
 * The full layout's navigation shapes, as the data the account screen renders.
 *
 * The compact counterpart of this file is `nav-style.ts`, and the two are
 * deliberately separate axes: a reader on a pinned-compact 1400px window gets
 * the bottom bar whatever they chose here, because this choice only decides what
 * the *full* layout draws. Neither preference can reach the other's layout.
 *
 * Unlike `COMPACT_NAV_STYLES`, these two are **not** the same size: the tree
 * spends 260px of width and keeps every module and section on screen at once;
 * the tab row spends ~90px of height and puts the modules that don't fit behind
 * an overflow menu. So the trade here is width against reach, and which wins
 * depends on whether a reader's screens are wide (tables, photo grids) or their
 * module list is long. See design.md, "The full layout's two shapes".
 *
 * A catalogue here rather than literals in the view for the same reason the
 * compact one is: the labels and the trade are facts about the shapes, the CLI
 * prints the same list, and `src/lib/` is where data-returning functions live.
 */
export interface DesktopNavStyleInfo {
  id: DesktopNavStyle;
  /** What the account screen calls it. */
  label: string;
  /** One line on how the navigation behaves. */
  description: string;
  /** The trade, stated plainly, so the choice can be made without trying both. */
  tradeoff: string;
  /** Horizontal space the page loses to navigation, in CSS pixels. */
  widthCost: number;
  /** Vertical space the page loses to navigation, in CSS pixels. */
  heightCost: number;
  /** Whether every module is reachable without opening a menu. */
  allModulesVisible: boolean;
}

export const DESKTOP_NAV_STYLES: readonly DesktopNavStyleInfo[] = [
  {
    id: "tree",
    label: "Side tree",
    description:
      "One column down the left carrying Home, every module and the sections of whichever modules are expanded.",
    tradeoff:
      "Every module and every expanded section is one click away and always visible — but it costs 260px of width, and a module with many sections fills the column.",
    widthCost: 260,
    heightCost: 96,
    allModulesVisible: true,
  },
  {
    id: "horizontal",
    label: "Top tabs",
    description:
      "Modules across a tab row, with the current module's sections on a strip beneath it. No side column at all.",
    tradeoff:
      "The page gets the full window width and navigation never scrolls — but only the modules that fit the row are visible, and the rest sit behind a More menu.",
    widthCost: 0,
    heightCost: 90,
    allModulesVisible: false,
  },
] as const;

/**
 * The shape a reader gets before choosing, and the fallback for a garbled value.
 *
 * `tree` rather than `horizontal` on purpose: it is what every reader already has,
 * so the preference ships changing nothing until it is deliberately switched.
 */
export const DEFAULT_DESKTOP_NAV_STYLE: DesktopNavStyle = "tree";

/**
 * Narrows an arbitrary stored or posted string to a known shape.
 *
 * Deliberately total, exactly as `resolveCompactNavStyle` is: an unrecognised
 * value returns the default rather than throwing, because a bad preference row
 * must not be able to break navigation — the one surface a reader needs in order
 * to reach the screen that would fix it.
 */
export function resolveDesktopNavStyle(value: string | undefined): DesktopNavStyle {
  return DESKTOP_NAV_STYLES.some((style) => style.id === value)
    ? (value as DesktopNavStyle)
    : DEFAULT_DESKTOP_NAV_STYLE;
}

/** The catalogue entry for a shape, for a caller that has the id and wants the label. */
export function getDesktopNavStyle(id: DesktopNavStyle): DesktopNavStyleInfo {
  const style = DESKTOP_NAV_STYLES.find((candidate) => candidate.id === id);
  // Unreachable via the type, but `find` is optional and the fallback keeps this
  // total for a caller that reached here with a cast or from parsed JSON.
  return style ?? DESKTOP_NAV_STYLES[0];
}
