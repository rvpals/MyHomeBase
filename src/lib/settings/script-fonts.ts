/**
 * The decorative script faces, and which of them each of the two script
 * surfaces wears.
 *
 * **Why this is a catalogue and not literals in the view.** The labels, the
 * legibility notes and the trade-offs are facts about the faces, not
 * presentation — the CLI prints the same list, and `src/lib/` is where
 * data-returning functions live. `COLOR_THEMES`, `ICON_SETS` and
 * `CHROME_STYLES` are the same shape, deliberately.
 *
 * **The ids are permanent.** Each is stored in a settings row
 * (migrations/0137) and resolved into a CSS variable in `src/app/layout.tsx`.
 * Renaming one silently drops the choice on every install that had picked it
 * and drops the surface back to Great Vibes — the same trap as an icon slot id.
 *
 * **Why there are two settings over one catalogue.** Until this shipped both
 * surfaces shared a single `--font-script` token, so the Daily Quote and the
 * Journal's handwriting sheet were necessarily the same face. They are
 * different kinds of writing — a proclamation you glance at versus your own
 * hand at length — so they now pick independently from this one list. See
 * design.md, "The two exceptions".
 */

/** The id stored in a settings row. Permanent — see the note above. */
export type ScriptFontId =
  | "great-vibes"
  | "dancing-script"
  | "caveat"
  | "kalam"
  | "parisienne"
  | "pinyon-script";

export interface ScriptFontInfo {
  id: ScriptFontId;
  /** What the admin screen calls it. */
  label: string;
  /** One line on the voice of the face — what it reads as. */
  description: string;
  /**
   * How well it holds up at length and at small sizes, stated plainly so the
   * choice can be made without trying all six. design.md keeps script off
   * anything read carefully, so this is the number that matters most.
   */
  legibility: "Low" | "Medium" | "High";
  /**
   * The CSS variable `src/app/layout.tsx` exposes its `localFont` loader under.
   * The seam between this catalogue and the font files: the loaders own the
   * variable names, this names which one to point a surface at.
   */
  cssVar: string;
}

/**
 * Every face offered, Great Vibes first because it is the default and what both
 * surfaces wore before either was configurable.
 *
 * Ordered roughly formal -> casual rather than alphabetically: an admin picking
 * a hand for a journal is choosing a register, and the list reads as a scale.
 */
export const SCRIPT_FONTS: readonly ScriptFontInfo[] = [
  {
    id: "great-vibes",
    label: "Great Vibes",
    description:
      "Formal copperplate calligraphy with long flourishes and high contrast between thick and thin strokes.",
    legibility: "Low",
    cssVar: "--font-great-vibes",
  },
  {
    id: "pinyon-script",
    label: "Pinyon Script",
    description:
      "Ornate engraved script with finer hairlines and tighter curls — the most decorative face here.",
    legibility: "Low",
    cssVar: "--font-pinyon-script",
  },
  {
    id: "parisienne",
    label: "Parisienne",
    description:
      "A lighter, airier copperplate. The closest sibling to Great Vibes, with shorter flourishes and more space between letters.",
    legibility: "Medium",
    cssVar: "--font-parisienne",
  },
  {
    id: "dancing-script",
    label: "Dancing Script",
    description:
      "Casual bouncy handwriting that sits letters on a lively baseline. Much more legible small than the copperplates.",
    legibility: "High",
    cssVar: "--font-dancing-script",
  },
  {
    id: "caveat",
    label: "Caveat",
    description:
      "A felt-tip marker hand — informal, slightly irregular, the way a note to yourself looks.",
    legibility: "High",
    cssVar: "--font-caveat",
  },
  {
    id: "kalam",
    label: "Kalam",
    description:
      "A relaxed pen hand with even strokes and an upright axis. The steadiest of the six over a long passage.",
    legibility: "High",
    cssVar: "--font-kalam",
  },
];

/**
 * Great Vibes — what both surfaces wore before this was configurable, so an
 * install that upgrades into the picker looks exactly as it did before.
 * migrations/0137 seeds both rows with this for the same reason.
 */
export const DEFAULT_SCRIPT_FONT: ScriptFontId = "great-vibes";

/** The settings keys the two picks are stored under. */
export const SCRIPT_FONT_SETTING_KEYS = {
  dailyQuote: "daily_quote_font",
  journalHandwriting: "journal_handwriting_font",
} as const;

/**
 * Resolves a stored value to a known face, falling back to the default for
 * anything unrecognised — so a hand-edited settings row, or a row left behind
 * by a face that was later removed from the catalogue, leaves the surface
 * readable rather than with no font-family at all.
 */
export function resolveScriptFont(value: string | undefined | null): ScriptFontId {
  const match = SCRIPT_FONTS.find((font) => font.id === value);
  return match ? match.id : DEFAULT_SCRIPT_FONT;
}

/**
 * The CSS variable a stored value should point its surface at, resolved through
 * the same fallback as `resolveScriptFont`. This is what `layout.tsx` writes
 * into `--font-script` and `--font-script-journal`.
 */
export function scriptFontCssVar(value: string | undefined | null): string {
  const id = resolveScriptFont(value);
  const match = SCRIPT_FONTS.find((font) => font.id === id);
  // `match` cannot be undefined — `resolveScriptFont` only returns catalogue
  // ids — but the fallback keeps this total rather than asserting.
  return match ? match.cssVar : "--font-great-vibes";
}

/** Looks a face up for display. Returns undefined for an unknown id. */
export function getScriptFont(id: string): ScriptFontInfo | undefined {
  return SCRIPT_FONTS.find((font) => font.id === id);
}
