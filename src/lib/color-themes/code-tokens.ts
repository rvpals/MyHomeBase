// Syntax-highlighting colours, derived from whatever theme is running.
//
// ## Why these are derived and not chosen
//
// Every editor palette in the world — Dracula, Solarized, the GitHub pair — is a
// fixed set of hexes. None of them can be used here. A theme in this app is nine
// colours and three fonts (`ColorThemeTokens`), themes are **created by admins at
// runtime** and stored in a table, and two of the built-ins are light. A shipped
// palette would be the same six colours on all of them, which is exactly the
// mistake `clp_clips.card_color` avoids by storing `'rose'` instead of a hex, and
// exactly why Shiki was rejected for this (it emits per-token inline `style`,
// which is both unthemeable and stripped by the clip sanitizer).
//
// So the palette is computed from the theme's own accent: take `brass`, rotate its
// hue by a fixed offset per role, and then move lightness until the result is
// actually readable on that theme's `paper`. The offsets are the recognisable part
// — keywords, strings and numbers stay in a consistent relationship to each other
// whatever theme is running — and the contrast step is what stops the result being
// unreadable on a theme nobody anticipated.
//
// ## Why contrast is enforced rather than warned about
//
// `contrast.ts` is deliberately warn-only: it reports on a theme and lets a human
// decide, because a low-contrast hairline is a legitimate house style. This is the
// opposite case. Nobody picks these colours, so there is nobody to show a warning
// to — an unreadable derived value would simply ship. The loop below therefore
// *fixes* the lightness rather than reporting on it.

import { CONTRAST_AA_TEXT, colorSchemeFor, contrastRatio } from "./contrast";
import { hexToHsl, hslToHex } from "./generate";
import type { ColorThemeTokens } from "@/lib/settings";

/**
 * One colour per thing a highlighter can mark.
 *
 * Six roles, not twenty. Prism emits dozens of token classes and most editors map
 * them to a handful of colours anyway; more roles here would mean more hues to
 * keep distinguishable on an arbitrary theme, which is the one thing this scheme
 * cannot promise. The CSS maps Prism's classes onto these.
 */
export interface CodeTokens {
  /** `if`, `return`, `SELECT` — the language's own words. */
  keyword: string;
  /** Quoted text, and anything else literal-looking. */
  string: string;
  /** Numbers, booleans, `null`. */
  number: string;
  /** Comments. Rendered italic as well, so they read as aside even in greyscale. */
  comment: string;
  /** Function and class names at their call or declaration site. */
  entity: string;
  /** Operators, brackets, commas — present but never competing for attention. */
  punctuation: string;
}

/**
 * Hue offsets from the theme's accent, in degrees, and how saturated each role is.
 *
 * The offsets are spread rather than evenly spaced: +150 and -90 sit far enough
 * from the accent and from each other to stay distinguishable, while `entity` at
 * +40 is deliberately a near-neighbour of the accent, because a function name
 * sitting close in hue to a keyword reads as related, which it is.
 *
 * `punctuation` and `comment` carry almost no saturation on purpose. They are the
 * two roles that should recede, and desaturating is a safer way to achieve that
 * on an unknown theme than darkening, which the contrast step would undo.
 */
const ROLES: Record<keyof CodeTokens, { hueOffset: number; saturation: number }> = {
  keyword: { hueOffset: 0, saturation: 70 },
  string: { hueOffset: 150, saturation: 55 },
  number: { hueOffset: -90, saturation: 60 },
  entity: { hueOffset: 40, saturation: 62 },
  comment: { hueOffset: 0, saturation: 12 },
  punctuation: { hueOffset: 0, saturation: 8 },
};

/**
 * How far one step of the search moves lightness, and how many steps it may take.
 *
 * 2% per step is fine enough that the accepted colour is close to the intended
 * one, and 40 steps covers the whole 0–100 range from any starting point — so the
 * loop always terminates, and on a theme where nothing can pass it ends at the
 * extreme rather than spinning.
 */
const STEP = 2;
const MAX_STEPS = 40;

/**
 * Moves a colour's lightness until it clears AA against the background.
 *
 * Direction is decided by the page, not the colour: on a dark theme the only way
 * out is lighter, on a light theme darker. Walking the wrong way would cross the
 * background's own luminance and make things worse before they got better.
 *
 * Returns the first passing colour, or — if nothing passes, which means the
 * background sits in the middle of the range — the most extreme one tried. That
 * is a deliberate "best effort" rather than a throw: a theme must still render.
 */
function ensureContrast(
  hue: number,
  saturation: number,
  startLightness: number,
  background: string,
): string {
  const towardsLighter = colorSchemeFor(background) === "dark";

  let best = hslToHex(hue, saturation, startLightness);
  let bestRatio = contrastRatio(best, background) ?? 0;

  for (let step = 0; step <= MAX_STEPS; step += 1) {
    const lightness = towardsLighter
      ? Math.min(100, startLightness + step * STEP)
      : Math.max(0, startLightness - step * STEP);

    const candidate = hslToHex(hue, saturation, lightness);
    const ratio = contrastRatio(candidate, background) ?? 0;

    if (ratio >= CONTRAST_AA_TEXT) return candidate;

    // Keep the best seen, so the fallback is the most readable thing tried
    // rather than whichever iteration happened to be last.
    if (ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
  }

  return best;
}

/**
 * The code palette for a theme.
 *
 * Always answers — like `resolveActiveTheme`, this is called from a render path
 * and cannot throw. A theme whose `brass` is not a parseable hex (a hand-edited
 * row) falls back to a neutral hue rather than failing the page; the result is a
 * greyscale-ish palette, which is legible even if it is dull.
 *
 * Contrast is measured against `paper`, not `paperRaised`, because a code block
 * is drawn on the page's base surface. If that ever changes, this has to change
 * with it or the guarantee is measuring the wrong thing.
 */
export function deriveCodeTokens(tokens: ColorThemeTokens): CodeTokens {
  const accent = hexToHsl(tokens.brass);
  const hue = accent?.h ?? 0;

  // The starting lightness, before the contrast walk. Begins on the far side of
  // the background so the search usually succeeds on its first or second step
  // rather than crossing the whole range.
  const start = colorSchemeFor(tokens.paper) === "dark" ? 62 : 38;

  const derive = (role: keyof CodeTokens): string => {
    const { hueOffset, saturation } = ROLES[role];
    return ensureContrast(hue + hueOffset, saturation, start, tokens.paper);
  };

  return {
    keyword: derive("keyword"),
    string: derive("string"),
    number: derive("number"),
    entity: derive("entity"),
    comment: derive("comment"),
    punctuation: derive("punctuation"),
  };
}

/**
 * The palette as CSS custom properties, for the theme `<style>` block in the root
 * layout.
 *
 * Emitted there with the rest of the theme rather than written into a stylesheet,
 * for the reason every other token is: the values depend on which theme is
 * active, and that is only known at render.
 */
export function codeTokensToCss(tokens: CodeTokens): string {
  return [
    `--code-keyword:${tokens.keyword}`,
    `--code-string:${tokens.string}`,
    `--code-number:${tokens.number}`,
    `--code-entity:${tokens.entity}`,
    `--code-comment:${tokens.comment}`,
    `--code-punctuation:${tokens.punctuation}`,
  ].join(";");
}
