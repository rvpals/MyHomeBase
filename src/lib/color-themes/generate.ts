import { FONT_KEYS, type ColorThemeFonts, type ColorThemeTokens, type FontKey } from "@/lib/settings";
import {
  CONTRAST_AA_LARGE,
  CONTRAST_AA_TEXT,
  contrastRatio,
  failingContrastPairs,
} from "./contrast";
import { slugifyThemeName } from "./schema";

/**
 * Random theme generation.
 *
 * Pure functions over a seeded random source: given the same seed they produce the same
 * themes, which is what makes them testable without snapshotting colours.
 *
 * **The tokens are derived, not rolled independently.** Nine random hex values are
 * essentially guaranteed to be unreadable — the interesting constraint is that a theme's
 * slots have *relationships* (a card sits just above the page, secondary text sits
 * between the page and the body text, the accent's soft fill is a desaturated shade of
 * the accent). So one random hue plus a mode picks the family, and everything else is
 * computed from it in HSL. Every candidate is then run through the same
 * `failingContrastPairs` the builder shows an admin, and rejected if it fails — the
 * generator can't offer a theme the builder would flag.
 */

// ---------------------------------------------------------------------------
// A seeded PRNG. `Math.random()` would make this untestable, and a generator
// whose output can't be pinned is one nobody can safely change later.
// ---------------------------------------------------------------------------

/** mulberry32 — small, fast, good enough for picking colours. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// HSL → hex. The generator thinks in HSL because the relationships it needs
// (same hue, more lightness) are one-axis moves there and arithmetic in hex.
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** `#RRGGBB` for an HSL triple. `h` in degrees, `s`/`l` as percentages. */
export function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 100) / 100;
  const light = clamp(l, 0, 100) / 100;

  const chroma = (1 - Math.abs(2 * light - 1)) * sat;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = light - chroma / 2;

  const sextant = Math.floor(hue / 60) % 6;
  const [r, g, b] = (
    [
      [chroma, secondary, 0],
      [secondary, chroma, 0],
      [0, chroma, secondary],
      [0, secondary, chroma],
      [secondary, 0, chroma],
      [chroma, 0, secondary],
    ] as const
  )[sextant];

  const toByte = (channel: number) =>
    Math.round((channel + match) * 255)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();

  return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

/**
 * Word lists for names. Two halves so a name reads like the built-ins do
 * ("Signal Deck", "Copper Vault") rather than as a hex code or a UUID.
 *
 * The first word is picked by *hue* so the name and the colour agree — a green theme
 * shouldn't come out called "Crimson". The second is free.
 */
const HUE_WORDS: { maxHue: number; words: readonly string[] }[] = [
  { maxHue: 15, words: ["Crimson", "Ember", "Rust"] },
  { maxHue: 45, words: ["Amber", "Copper", "Bronze"] },
  { maxHue: 70, words: ["Brass", "Citron", "Harvest"] },
  { maxHue: 150, words: ["Verdant", "Fern", "Jade"] },
  { maxHue: 190, words: ["Teal", "Lagoon", "Signal"] },
  { maxHue: 240, words: ["Azure", "Cobalt", "Glacier"] },
  { maxHue: 280, words: ["Indigo", "Violet", "Twilight"] },
  { maxHue: 320, words: ["Orchid", "Magenta", "Plum"] },
  { maxHue: 360, words: ["Rose", "Garnet", "Coral"] },
];

const NOUNS = [
  "Deck",
  "Ledger",
  "Vault",
  "Console",
  "Atlas",
  "Archive",
  "Harbour",
  "Foundry",
  "Lantern",
  "Meridian",
] as const;

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)];
}

function hueWord(random: () => number, hue: number): string {
  const band = HUE_WORDS.find((entry) => hue < entry.maxHue) ?? HUE_WORDS[HUE_WORDS.length - 1];
  return pick(random, band.words);
}

// ---------------------------------------------------------------------------
// Token derivation
// ---------------------------------------------------------------------------

/** Dark themes carry a light `ink`; light themes invert the whole stack. */
export type ThemeMode = "dark" | "light";

/**
 * Nine tokens from one hue, one accent hue and a mode.
 *
 * The numbers are tuned against the eight built-ins rather than invented: a dark theme's
 * page sits around 8% lightness with a card a few points above it, body text in the
 * nineties, and an accent bright enough to read on its own tint. Light themes mirror
 * that. Surfaces keep a little of the accent's hue so a theme reads as one family
 * instead of grey boxes with a coloured button.
 */
/**
 * An accent shade at `hue` that actually reads on `background`.
 *
 * This exists because **a fixed HSL lightness is not a fixed contrast.** Perceived
 * luminance varies hugely with hue at the same `l`: green at 36% is bright, blue at 36%
 * is nearly black. The first version of this generator pinned `brassDark` to one
 * lightness, so `brass-dark-on-brass-soft` measured 5.6:1 for green and 1.4:1 for blue —
 * and since that pair has a 3:1 threshold, every blue, violet, magenta and red candidate
 * was rejected. 58% of the hue wheel failed on dark mode and 75% on light, leaving only
 * yellow-green-teal. That is why a batch came out as five greens.
 *
 * So the lightness is *searched* rather than assumed: walk away from the background in
 * 2% steps and take the first shade that clears the bar with a little headroom. Walking
 * is fine here — 50 cheap ratio calculations, done once per generated theme, and it
 * always terminates because the far end of the scale is white or black.
 */
function accentTextOn(
  background: string,
  hue: number,
  saturation: number,
  direction: "lighter" | "darker",
  threshold: number = CONTRAST_AA_LARGE,
): string {
  const step = direction === "lighter" ? 2 : -2;
  const start = direction === "lighter" ? 30 : 70;
  // A margin over the threshold so a theme lands comfortably clear of the bar rather
  // than exactly on it, where rounding could tip it either way.
  const target = threshold + 0.4;

  let best = hslToHex(hue, saturation, start);
  let bestRatio = contrastRatio(best, background) ?? 0;

  for (let lightness = start; lightness >= 0 && lightness <= 100; lightness += step) {
    const candidate = hslToHex(hue, saturation, lightness);
    const ratio = contrastRatio(candidate, background) ?? 0;
    if (ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
    if (ratio >= target) return candidate;
  }

  // Nothing cleared the bar: return the best found. The caller still runs the full
  // contrast check and will reject the theme, so this never ships a failing one.
  return best;
}

export function deriveTokens(
  hue: number,
  accentHue: number,
  mode: ThemeMode,
  fonts: ColorThemeFonts,
): ColorThemeTokens {
  if (mode === "dark") {
    const brassSoft = hslToHex(accentHue, 38, 16);
    return {
      paper: hslToHex(hue, 14, 8),
      paperRaised: hslToHex(hue, 13, 12),
      ink: hslToHex(hue, 12, 94),
      line: hslToHex(hue, 11, 22),
      muted: hslToHex(hue, 9, 62),
      mutedInverse: hslToHex(hue, 8, 42),
      brass: hslToHex(accentHue, 72, 60),
      brassDark: accentTextOn(brassSoft, accentHue, 62, "lighter"),
      brassSoft,
      fonts,
    };
  }

  const brassSoft = hslToHex(accentHue, 52, 91);
  const paper = hslToHex(hue, 16, 96);
  return {
    paper,
    paperRaised: "#FFFFFF",
    ink: hslToHex(hue, 22, 16),
    line: hslToHex(hue, 14, 87),
    // Secondary text has to clear the 4.5 body-text bar against a near-white page, and
    // a fixed 42% lightness left it at 4.2-4.4 for some hues — just under.
    muted: accentTextOn(paper, hue, 12, "darker", CONTRAST_AA_TEXT),
    mutedInverse: hslToHex(hue, 10, 64),
    // The accent has to work as a button fill *and* as text on the page, which is the
    // same 3:1 pair measured both ways (`brass-on-paper` / `paper-on-brass`). A fixed
    // 40% lightness failed for the naturally-bright hues — yellow-green at 40% is only
    // 2.6:1 on white.
    brass: accentTextOn(paper, accentHue, 68, "darker"),
    brassDark: accentTextOn(brassSoft, accentHue, 70, "darker"),
    brassSoft,
    fonts,
  };
}

/** One generated theme, ready for `createColorTheme`. */
export interface GeneratedTheme {
  id: string;
  name: string;
  description: string;
  tokens: ColorThemeTokens;
}

function randomFonts(random: () => number): ColorThemeFonts {
  // Mono is only ever used for code, so any of the keys is fine there; display and body
  // are picked from the non-mono faces so a heading never renders in JetBrains Mono.
  const proportional = FONT_KEYS.filter((key) => !key.includes("mono")) as FontKey[];
  const monos = FONT_KEYS.filter((key) => key.includes("mono")) as FontKey[];
  return {
    display: pick(random, proportional),
    body: pick(random, proportional),
    mono: pick(random, monos),
  };
}

/**
 * One candidate theme. Not guaranteed to pass contrast — `generateThemes` checks.
 *
 * The accent hue is offset from the surface hue by 25–155° so the accent reads as a
 * *signal* against the surfaces rather than disappearing into them, which is what a
 * fully independent random hue would do a third of the time.
 */
function generateCandidate(
  random: () => number,
  taken: Set<string>,
  accentHue: number,
): GeneratedTheme | undefined {
  // The surface hue is offset *from the accent*, not rolled independently. The accent is
  // the hue the caller has already spread across the wheel (see `generateThemes`), and it
  // is the one a reader actually names the theme by — so it is the fixed point, and the
  // near-neutral surfaces move to sit beside it.
  const hue = (accentHue + 180 + Math.floor(random() * 80) - 40 + 360) % 360;
  const mode: ThemeMode = random() < 0.72 ? "dark" : "light";

  const tokens = deriveTokens(hue, accentHue, mode, randomFonts(random));
  if (failingContrastPairs(tokens).length > 0) return undefined;

  // `hueWord` is called ONCE and reused. Calling it twice drew two different randoms and
  // could pick two different words from the same band, producing "Fern Harbour — built
  // around a jade accent": a name and a description that disagree about the same colour.
  const colourWord = hueWord(random, accentHue);
  const name = `${colourWord} ${pick(random, NOUNS)}`;
  const id = slugifyThemeName(name);
  // An id collision is a name collision: both would be rejected downstream, and a
  // suffixed "-2" name reads like a mistake on a picker card.
  if (!id || taken.has(id)) return undefined;

  return {
    id,
    name,
    description: `A generated ${mode} theme built around a ${colourWord.toLowerCase()} accent.`,
    tokens,
  };
}


/**
 * `count` themes that all pass the contrast check and don't collide with `existingIds`.
 *
 * **Accent hues are spread, not rolled independently.** Five uniform draws from a
 * 360-degree wheel cluster badly — in practice a batch would come back as five greens or
 * five ambers, which is what shipped first and looked broken. The wheel is instead cut
 * into `count` equal sectors, one theme per sector, with the whole set rotated by a
 * random offset and jittered inside each sector. So a batch of five is always spread
 * roughly 72 degrees apart while still differing run to run.
 *
 * The sector order is shuffled before use so the cards don't come out in rainbow order,
 * which reads as generated rather than picked.
 *
 * Returns fewer than asked only if the attempt budget runs out — the caller reports what
 * it got rather than retrying forever. The budget exists because rejection is expected: a
 * candidate can fail contrast or repeat a name, and an unbounded loop would be a hang
 * waiting to happen. Retries stay *inside* the sector, so a rejected candidate cannot
 * quietly hand its slot to a hue some other theme already has.
 */
export function generateThemes(
  count: number,
  existingIds: string[],
  seed: number,
): GeneratedTheme[] {
  if (count <= 0) return [];

  const random = createRandom(seed);
  const taken = new Set(existingIds);
  const generated: GeneratedTheme[] = [];

  const sectorWidth = 360 / count;
  const rotation = random() * 360;

  // Sector centres, shuffled (Fisher-Yates) so the batch isn't in hue order.
  const sectors = Array.from({ length: count }, (_, index) => index);
  for (let index = sectors.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [sectors[index], sectors[swap]] = [sectors[swap], sectors[index]];
  }

  for (const sector of sectors) {
    // Up to 40 tries in this sector. Jitter covers the middle 80% of the sector so two
    // adjacent sectors can't meet at their shared edge and produce near-identical hues.
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const jitter = (random() - 0.5) * sectorWidth * 0.8;
      const accentHue = (rotation + sector * sectorWidth + jitter + 360) % 360;

      const candidate = generateCandidate(random, taken, accentHue);
      if (!candidate) continue;
      taken.add(candidate.id);
      generated.push(candidate);
      break;
    }
  }

  return generated;
}
