import type { CompactNavStyle } from "./types";

/**
 * The compact navigation styles, as the data the account screen renders.
 *
 * Both put every tier on the bottom edge — the module switcher is *not* in the
 * header on compact — and both are the same height, so the choice costs no
 * vertical space either way (design.md, "What compact does differently"). They
 * differ only in how one bar divides between the two tiers, which is a genuine
 * preference rather than a right answer: A is the bigger touch target, B is the
 * fewer taps, and which wins depends entirely on how often a reader switches
 * module rather than section.
 *
 * A catalogue here rather than literals in the view because the labels and the
 * tap costs are facts about the styles, not presentation — the CLI prints the
 * same list, and `src/lib/` is where data-returning functions live.
 * `COLOR_THEMES` and `ICON_SETS` in `src/lib/settings` are the same shape.
 */
export interface CompactNavStyleInfo {
  id: CompactNavStyle;
  /** What the account screen calls it. */
  label: string;
  /** One line on how the bar behaves. */
  description: string;
  /** The trade, stated plainly, so the choice can be made without trying both. */
  tradeoff: string;
  /** Taps to reach another section of the module you're already in. */
  tapsToSection: number;
  /** Taps to reach another module. */
  tapsToModule: number;
}

export const COMPACT_NAV_STYLES: readonly CompactNavStyleInfo[] = [
  {
    id: "drill-in",
    label: "One bar",
    description:
      "A single bar naming both the module and the section. Tapping it lists the module's sections; a back arrow steps up to the module list.",
    tradeoff:
      "The whole bar is one large target and it names where you are in words — but switching module takes one extra tap.",
    tapsToSection: 2,
    tapsToModule: 3,
  },
  {
    id: "segmented",
    label: "Split bar",
    description:
      "The bar is split: the module icon on the left opens the module list, the section name fills the rest and opens the section list.",
    tradeoff:
      "Every module and section is one tap away — but the module half is a smaller target and shows an icon rather than a name.",
    tapsToSection: 2,
    tapsToModule: 2,
  },
] as const;

/** The style a reader gets before choosing, and the fallback for a garbled value. */
export const DEFAULT_COMPACT_NAV_STYLE: CompactNavStyle = "drill-in";

/**
 * Narrows an arbitrary stored or posted string to a known style.
 *
 * Deliberately total: an unrecognised value returns the default rather than
 * throwing, because a bad preference row must not be able to break navigation —
 * the one surface a reader needs in order to reach the screen that would fix it.
 */
export function resolveCompactNavStyle(value: string | undefined): CompactNavStyle {
  return COMPACT_NAV_STYLES.some((style) => style.id === value)
    ? (value as CompactNavStyle)
    : DEFAULT_COMPACT_NAV_STYLE;
}

/** The catalogue entry for a style, for a caller that has the id and wants the label. */
export function getCompactNavStyle(id: CompactNavStyle): CompactNavStyleInfo {
  const style = COMPACT_NAV_STYLES.find((candidate) => candidate.id === id);
  // Unreachable via the type, but `find` is optional and the fallback keeps this
  // total for a caller that reached here with a cast or from parsed JSON.
  return style ?? COMPACT_NAV_STYLES[0];
}
