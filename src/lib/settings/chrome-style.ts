import type { ChromeStyle } from "./types";

/**
 * The border treatments the app's chrome can wear, as the data the admin screen
 * renders.
 *
 * "Chrome" here is two surfaces: the utility header (`AppHeader` — the
 * breadcrumb bar) and the desktop navigation tree (`NavTree` — the 260px column
 * and its module slabs). They are one setting rather than two because they are
 * the same frame around the page, and a raised header above a sunken column
 * reads as a bug rather than a choice.
 *
 * A catalogue here rather than literals in the view because the labels and the
 * trade-offs are facts about the styles, not presentation — the CLI prints the
 * same list, and `src/lib/` is where data-returning functions live.
 * `COLOR_THEMES`, `ICON_SETS` and `COMPACT_NAV_STYLES` are the same shape.
 *
 * **The ids are permanent.** Each is stored in the `chrome_style` row
 * (migrations/0121) and selected on by `html[data-chrome-style="…"]` rules in
 * globals.css. Renaming one silently drops the choice on every install that had
 * picked it, the same trap as an icon slot id.
 *
 * Every style is expressed with `--edge-lit`/`color-mix` rather than literal
 * whites, so each one inverts correctly between a dark and a light theme — a
 * translucent-white lip is a highlight on `#12161a` and invisible on near-white
 * paper. See the `--edge-lit` comment in globals.css for the measured argument.
 */
export interface ChromeStyleInfo {
  id: ChromeStyle;
  /** What the admin screen calls it. */
  label: string;
  /** One line on what the treatment does. */
  description: string;
  /** The trade, stated plainly, so the choice can be made without trying all four. */
  tradeoff: string;
}

export const CHROME_STYLES: readonly ChromeStyleInfo[] = [
  {
    id: "current",
    label: "Flat",
    description:
      "Module slabs are gently embossed; the header and the tree column are flat, separated from the page by a single hairline.",
    tradeoff:
      "The quietest option, and the one the app shipped with — but the header can read as part of the page rather than as its frame.",
  },
  {
    id: "inset",
    label: "Inset",
    description:
      "The header and the tree column are pressed into the page: shaded along the top lip, lit along the bottom. The selected module is the one surface left flush.",
    tradeoff:
      "Selection reads strongly, because where you are is the only thing not sunken — but the chrome sits visually behind the content it frames.",
  },
  {
    id: "outset",
    label: "Outset",
    description:
      "The header and the tree column lift off the page with a lit top edge, a shaded underside and a cast shadow. The selected row inverts and presses in.",
    tradeoff:
      "The strongest separation of chrome from content, and selection reads as a key held down — but it is the heaviest of the four.",
  },
  {
    id: "emboss",
    label: "Emboss",
    description:
      "The bevel is cut into the surface itself: no cast shadow, every edge a one-pixel lit and shaded pair, over a faint vertical gradient.",
    tradeoff:
      "Stamped-metal definition at almost no visual weight — but on a low-contrast theme the effect is subtle enough to miss.",
  },
] as const;

/** The style an install gets before choosing, and the fallback for a garbled value. */
export const DEFAULT_CHROME_STYLE: ChromeStyle = "current";

/**
 * Narrows an arbitrary stored or posted string to a known style.
 *
 * Deliberately total: an unrecognised value returns the default rather than
 * throwing, because a bad settings row must not be able to break the app's
 * chrome — the header and the navigation tree are how a reader reaches the
 * screen that would fix it. Same reasoning as `resolveCompactNavStyle`.
 */
export function resolveChromeStyle(value: string | undefined): ChromeStyle {
  return CHROME_STYLES.some((style) => style.id === value)
    ? (value as ChromeStyle)
    : DEFAULT_CHROME_STYLE;
}

/** The catalogue entry for a style, for a caller that has the id and wants the label. */
export function getChromeStyle(id: ChromeStyle): ChromeStyleInfo {
  const style = CHROME_STYLES.find((candidate) => candidate.id === id);
  // Unreachable via the type, but `find` is optional and the fallback keeps this
  // total for a caller that reached here with a cast or from parsed JSON.
  return style ?? CHROME_STYLES[0];
}
