import type { ColorThemeTokens } from "@/lib/settings";

/**
 * WCAG 2.1 relative luminance and contrast ratios, so the theme builder can warn that
 * a combination is unreadable before it is saved.
 *
 * Deliberately WARN-ONLY at the use-case level: nothing here rejects a theme. A house
 * style can legitimately want a low-contrast pairing (the `line` token is barely visible
 * against `paper` in every shipped theme — that is the point of a hairline), and this app
 * has one user who can see the result immediately. So these functions report, and the UI
 * shows what they report.
 *
 * Twenty lines of arithmetic rather than a dependency: the formula is fixed by the spec
 * and will not change.
 */

/** A parsed `#RRGGBB`, 0..255 per channel. `undefined` if the string is not one. */
export function parseHex(hex: string): { r: number; g: number; b: number } | undefined {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return undefined;
  const value = Number.parseInt(match[1], 16);
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

/**
 * WCAG relative luminance, 0 (black) to 1 (white).
 *
 * The 0.03928 branch is the spec's linearisation of sRGB's gamma curve, not a fudge —
 * dropping it overstates the contrast of dark colors, which is exactly the range most of
 * these themes live in.
 */
export function relativeLuminance(hex: string): number | undefined {
  const rgb = parseHex(hex);
  if (!rgb) return undefined;

  const channel = (raw: number): number => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/**
 * Contrast ratio between two colors, 1 (identical) to 21 (black on white).
 *
 * Order-independent by construction — the lighter color always ends up on top — so
 * callers do not have to know which of the pair is the background.
 */
export function contrastRatio(foreground: string, background: string): number | undefined {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  if (a === undefined || b === undefined) return undefined;
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG AA wants 4.5:1 for body text, 3:1 for large text and UI boundaries. */
export const CONTRAST_AA_TEXT = 4.5;
export const CONTRAST_AA_LARGE = 3;

export interface ContrastPair {
  /** Stable id, so the builder can key a row off it. */
  id: string;
  /** What this pairing is, in the app's own terms. */
  label: string;
  foreground: keyof ColorThemeTokens;
  background: keyof ColorThemeTokens;
  /**
   * The bar this pair is held to, or `undefined` for an INFORMATIONAL pair.
   *
   * An informational pair still gets its ratio measured and shown — it just never
   * reports a failure. That is not a cop-out: some pairings in this token set are
   * deliberately low-contrast, and every one of the eight shipped themes would trip a
   * naive 4.5 bar on them. A builder that warns about the app's own themes teaches the
   * user to ignore it.
   */
  threshold?: number;
}

/**
 * The pairings worth measuring.
 *
 * Not all 36 combinations of nine tokens — most never touch on screen, and reporting
 * them would bury the ones that matter. Each entry below is a place where one token is
 * genuinely rendered on top of the other.
 *
 * The thresholds were set by measuring all eight shipped themes (contrast.test.ts guards
 * them). Three measurements shaped this list:
 *
 * - `line` on `paper` is 1.1–1.5 in EVERY shipped theme. That is the hairline design.md
 *   describes as intentional ("Daybreak's is #E7E2E4 on white", definition coming from a
 *   stacked ring rather than the border itself). Informational.
 * - `paperRaised` on `paper` is a surface separation, not text — a theme may legitimately
 *   make cards nearly flush with the page. Informational.
 * - Solid accent buttons put `paper` on `brass`, NOT `mutedInverse` on `brass`
 *   (design.md: "bg-brass text-paper with the icon in text-paper"). Measured correctly it
 *   is 3.3–11 across the shipped themes; measured the wrong way it fails all eight, which
 *   is how this pair got into the list wrong the first time.
 */
export const CONTRAST_PAIRS: ContrastPair[] = [
  {
    id: "ink-on-paper",
    label: "Body text on the page",
    foreground: "ink",
    background: "paper",
    threshold: CONTRAST_AA_TEXT,
  },
  {
    id: "ink-on-paper-raised",
    label: "Body text on a card",
    foreground: "ink",
    background: "paperRaised",
    threshold: CONTRAST_AA_TEXT,
  },
  {
    id: "muted-on-paper",
    label: "Secondary text on the page",
    foreground: "muted",
    background: "paper",
    threshold: CONTRAST_AA_TEXT,
  },
  {
    id: "muted-on-paper-raised",
    label: "Secondary text on a card",
    foreground: "muted",
    background: "paperRaised",
    threshold: CONTRAST_AA_TEXT,
  },
  {
    id: "brass-on-paper",
    label: "Accent text and icons on the page",
    foreground: "brass",
    background: "paper",
    threshold: CONTRAST_AA_LARGE,
  },
  {
    id: "paper-on-brass",
    label: "Label on a solid accent button",
    foreground: "paper",
    background: "brass",
    threshold: CONTRAST_AA_LARGE,
  },
  {
    id: "brass-dark-on-brass-soft",
    label: "Accent text on an accent fill",
    foreground: "brassDark",
    background: "brassSoft",
    threshold: CONTRAST_AA_LARGE,
  },
  {
    id: "ink-on-brass-soft",
    label: "Body text on an accent fill",
    foreground: "ink",
    background: "brassSoft",
    threshold: CONTRAST_AA_TEXT,
  },
  // Informational from here down: measured and shown, never flagged.
  {
    id: "line-on-paper",
    label: "Borders against the page",
    foreground: "line",
    background: "paper",
  },
  {
    id: "paper-raised-on-paper",
    label: "Card against the page",
    foreground: "paperRaised",
    background: "paper",
  },
];

export interface ContrastFinding extends ContrastPair {
  /** The measured ratio, rounded to one decimal. */
  ratio: number;
  /** True when `ratio` is below `threshold`. */
  fails: boolean;
}

/**
 * Every checked pair with its measured ratio — passes included, so the builder can show
 * the whole picture rather than only complaints.
 *
 * A pair whose colors will not parse is omitted rather than reported as failing: an
 * unparseable hex is a validation error the schema already reports, and showing it here
 * too would mean two messages for one mistake.
 */
export function checkThemeContrast(tokens: ColorThemeTokens): ContrastFinding[] {
  const findings: ContrastFinding[] = [];

  for (const pair of CONTRAST_PAIRS) {
    const foreground = tokens[pair.foreground];
    const background = tokens[pair.background];
    if (typeof foreground !== "string" || typeof background !== "string") continue;

    const ratio = contrastRatio(foreground, background);
    if (ratio === undefined) continue;

    const rounded = Math.round(ratio * 10) / 10;
    // An informational pair (no threshold) never fails, however low it measures.
    const fails = pair.threshold !== undefined && rounded < pair.threshold;
    findings.push({ ...pair, ratio: rounded, fails });
  }

  return findings;
}

/** Just the failures, for a one-line summary. */
export function failingContrastPairs(tokens: ColorThemeTokens): ContrastFinding[] {
  return checkThemeContrast(tokens).filter((finding) => finding.fails);
}
