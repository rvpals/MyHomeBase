import type { BorderWidths } from "./types";

/**
 * The three independently adjustable border weights, as the data the admin
 * screen renders.
 *
 * Three axes rather than one setting because they have genuinely different
 * reach, and a reader who wants a heavier navigation frame does not necessarily
 * want every table cell in the app to thicken with it:
 *
 *   outline  the chrome's outer edges -- the header's bottom rule, the tree
 *            column's right rule, and each module slab's outline
 *   divider  the tree's *internal* rules -- the filter row's underline, the
 *            grouped-section boxes, the filter input's own border
 *   line     every other `--line` border in the app, on every screen
 *
 * `line` is deliberately last and deliberately described as app-wide: it is the
 * widest-reaching display setting in this project, and the one most likely to
 * need looking at on a real screen before it ships.
 *
 * A catalogue here rather than literals in the view because the labels, the
 * bounds and the defaults are facts about the setting, not presentation -- the
 * CLI prints the same list, and `src/lib/` is where data-returning functions
 * live. `CHROME_STYLES` and `COMPACT_NAV_STYLES` are the same shape.
 *
 * **The keys are permanent.** They are the encoding of the stored
 * `border_widths` row (migrations/0122), so renaming one silently drops that
 * axis back to its default on every install that had set it.
 */
export interface BorderWidthInfo {
  key: keyof BorderWidths;
  /** What the admin screen calls it. */
  label: string;
  /** One line on what the number does. */
  description: string;
  /** Which surfaces it reaches, so the choice can be made without trying it. */
  where: string;
}

export const BORDER_WIDTH_KEYS: readonly BorderWidthInfo[] = [
  {
    key: "outline",
    label: "Chrome outline",
    description: "The weight of the frame's outer edges.",
    where:
      "The header's bottom rule, the navigation column's right rule, and each module slab's outline.",
  },
  {
    key: "divider",
    label: "Inner dividers",
    description: "The weight of rules *inside* the navigation column.",
    where:
      "The filter row's underline, the grouped-section boxes, and the filter box's own border.",
  },
  {
    key: "line",
    label: "Everything else",
    description: "The weight of every other border in the application.",
    where:
      "Cards, tables, inputs and panels on every screen. The widest-reaching of the three — worth a look on a few screens before settling on a value.",
  },
] as const;

/** Thinnest border the app will draw. Below 1 a border is simply absent. */
export const MIN_BORDER_WIDTH = 1;

/**
 * Thickest border the app will draw.
 *
 * 4px, not higher: past that the `rounded-lg`/`rounded-xl` corners the app uses
 * everywhere start to read as lumps rather than curves, and on the 260px
 * navigation column every extra pixel of rule is a pixel of label width gone.
 */
export const MAX_BORDER_WIDTH = 4;

/** Every axis at 1px -- the weight the app used before this setting existed. */
export const DEFAULT_BORDER_WIDTHS: BorderWidths = { outline: 1, divider: 1, line: 1 };

/**
 * Clamps one axis to a whole number of pixels inside the allowed range.
 *
 * Deliberately total: anything unparseable returns the default rather than
 * throwing. A bad row must not be able to break the app's chrome, which is how
 * a reader reaches the screen that would fix it -- the same reasoning
 * `resolveChromeStyle` documents. `Math.round` because a fractional border
 * renders as an antialiased smear at some zoom levels on Windows.
 */
export function parseBorderWidth(value: string | number | undefined): number {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed)) return MIN_BORDER_WIDTH;
  return Math.min(MAX_BORDER_WIDTH, Math.max(MIN_BORDER_WIDTH, Math.round(parsed)));
}

/**
 * Reads the stored `border_widths` value into all three axes.
 *
 * The encoding is `outline=1,divider=2,line=1` -- one row rather than three
 * because the three are always read and written together, so one row means one
 * migration if a fourth axis is ever added. Same shape as `home_widgets`.
 *
 * A missing or unparseable axis falls back to its default independently, so a
 * partially garbled value still yields two good numbers rather than none.
 */
export function resolveBorderWidths(stored: string | undefined): BorderWidths {
  const pairs = new Map(
    (stored ?? "")
      .split(",")
      .map((part) => part.split("="))
      .filter((parts): parts is [string, string] => parts.length === 2)
      .map(([key, value]) => [key.trim(), value.trim()]),
  );

  return {
    outline: parseBorderWidth(pairs.get("outline")),
    divider: parseBorderWidth(pairs.get("divider")),
    line: parseBorderWidth(pairs.get("line")),
  };
}

/** Encodes the three axes back to the stored form. Round-trips `resolveBorderWidths`. */
export function borderWidthsToValue(widths: BorderWidths): string {
  return BORDER_WIDTH_KEYS.map((axis) => `${axis.key}=${parseBorderWidth(widths[axis.key])}`).join(
    ",",
  );
}
