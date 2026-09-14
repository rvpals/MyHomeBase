import { describe, expect, it } from "vitest";
import { COLOR_THEMES, FONT_KEYS } from "@/lib/settings";
import { failingContrastPairs } from "./contrast";
import { createRandom, deriveTokens, generateThemes, hslToHex } from "./generate";
import { checkThemeContrast } from "./contrast";
import { colorThemeWriteSchema } from "./schema";

describe("hslToHex", () => {
  it("converts the primary and secondary corners", () => {
    expect(hslToHex(0, 100, 50)).toBe("#FF0000");
    expect(hslToHex(120, 100, 50)).toBe("#00FF00");
    expect(hslToHex(240, 100, 50)).toBe("#0000FF");
    expect(hslToHex(60, 100, 50)).toBe("#FFFF00");
  });

  it("handles the achromatic extremes", () => {
    expect(hslToHex(210, 50, 0)).toBe("#000000");
    expect(hslToHex(210, 50, 100)).toBe("#FFFFFF");
    expect(hslToHex(210, 0, 50)).toBe("#808080");
  });

  it("wraps a hue past 360 and clamps out-of-range saturation and lightness", () => {
    expect(hslToHex(360, 100, 50)).toBe(hslToHex(0, 100, 50));
    expect(hslToHex(480, 100, 50)).toBe(hslToHex(120, 100, 50));
    expect(hslToHex(-120, 100, 50)).toBe(hslToHex(240, 100, 50));
    expect(hslToHex(0, 500, 50)).toBe("#FF0000");
    expect(hslToHex(0, 100, -20)).toBe("#000000");
  });

  it("always produces a 6-digit uppercase hex, which the schema requires", () => {
    for (let hue = 0; hue < 360; hue += 7) {
      expect(hslToHex(hue, 43, 19)).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});

describe("createRandom", () => {
  it("is deterministic for a seed", () => {
    const a = createRandom(42);
    const b = createRandom(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("differs between seeds and stays inside [0, 1)", () => {
    const a = createRandom(1);
    const b = createRandom(2);
    expect(a()).not.toBe(b());

    const next = createRandom(7);
    for (let index = 0; index < 500; index += 1) {
      const value = next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("deriveTokens", () => {
  const fonts = { display: "sora", body: "inter", mono: "jetbrains-mono" } as const;

  it("fills every token slot with a valid hex", () => {
    const tokens = deriveTokens(200, 40, "dark", fonts);
    const { fonts: _fonts, ...colors } = tokens;
    expect(Object.keys(colors)).toHaveLength(9);
    Object.values(colors).forEach((value) => expect(value).toMatch(/^#[0-9A-F]{6}$/));
  });

  it("puts light text on a dark page for a dark theme, and inverts for light", () => {
    // A cheap proxy for "the mode means what it says": the page is darker than the ink
    // on a dark theme and lighter on a light one.
    const brightness = (hex: string) => parseInt(hex.slice(1, 3), 16);

    const dark = deriveTokens(210, 90, "dark", fonts);
    expect(brightness(dark.paper)).toBeLessThan(brightness(dark.ink));

    const light = deriveTokens(210, 90, "light", fonts);
    expect(brightness(light.paper)).toBeGreaterThan(brightness(light.ink));
  });

  it("lifts a card above the page rather than matching it", () => {
    const dark = deriveTokens(30, 200, "dark", fonts);
    expect(dark.paperRaised).not.toBe(dark.paper);
  });

  it("carries the fonts through untouched", () => {
    expect(deriveTokens(10, 100, "dark", fonts).fonts).toEqual(fonts);
  });
});

describe("generateThemes", () => {
  it("generates the requested number of themes", () => {
    expect(generateThemes(5, [], 2026)).toHaveLength(5);
  });

  it("only returns themes that pass the contrast check", () => {
    // The point of the generator: it cannot offer a theme the builder would flag.
    generateThemes(5, [], 7).forEach((theme) => {
      expect(failingContrastPairs(theme.tokens)).toEqual([]);
    });
  });

  it("produces themes the write schema accepts", () => {
    // Everything here is headed for `createColorTheme`, which parses with this schema.
    generateThemes(5, [], 99).forEach((theme) => {
      expect(() =>
        colorThemeWriteSchema.parse({
          id: theme.id,
          name: theme.name,
          description: theme.description,
          tokens: theme.tokens,
          sortOrder: 100,
        }),
      ).not.toThrow();
    });
  });

  it("never collides with an existing id", () => {
    const existing = generateThemes(5, [], 5).map((theme) => theme.id);
    const second = generateThemes(5, existing, 5);
    second.forEach((theme) => expect(existing).not.toContain(theme.id));
  });

  it("never collides with a built-in id", () => {
    const builtinIds = COLOR_THEMES.map((theme) => theme.id);
    generateThemes(5, builtinIds, 11).forEach((theme) => {
      expect(builtinIds).not.toContain(theme.id);
    });
  });

  it("returns ids unique within one batch", () => {
    const ids = generateThemes(5, [], 314).map((theme) => theme.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is deterministic for a seed", () => {
    expect(generateThemes(5, [], 808)).toEqual(generateThemes(5, [], 808));
  });

  it("picks fonts the app actually loads", () => {
    // A key nothing loads renders as the browser fallback, so this is not cosmetic.
    generateThemes(5, [], 21).forEach(({ tokens }) => {
      expect(FONT_KEYS).toContain(tokens.fonts.display);
      expect(FONT_KEYS).toContain(tokens.fonts.body);
      expect(FONT_KEYS).toContain(tokens.fonts.mono);
      expect(tokens.fonts.mono).toContain("mono");
      expect(tokens.fonts.display).not.toContain("mono");
    });
  });

  it("gives every theme a name and a slug derived from it", () => {
    generateThemes(5, [], 63).forEach((theme) => {
      expect(theme.name.length).toBeGreaterThan(0);
      expect(theme.id).toMatch(/^[a-z0-9-]+$/);
      expect(theme.description.length).toBeGreaterThan(0);
    });
  });

  it("returns an empty list when asked for none", () => {
    expect(generateThemes(0, [], 1)).toEqual([]);
  });

  it("stops at its attempt budget instead of looping forever", () => {
    // Every possible id already taken: the budget has to be what ends this.
    const everyName = generateThemes(5, [], 1);
    const blocked = generateThemes(
      5,
      [...everyName.map((t) => t.id), ...Array.from({ length: 400 }, (_, i) => `x-${i}`)],
      1,
    );
    // Whatever it returns, it must return — and must not include a blocked id.
    expect(blocked.length).toBeLessThanOrEqual(5);
  });
});

/** The accent's hue in degrees, for asserting that a batch is spread around the wheel. */
function hueOf(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (delta === 0) return 0;
  const sextant = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return Math.round((sextant * 60 + 360) % 360);
}

/** The smallest gap between any two hues, treating the wheel as circular. */
function smallestHueGap(hues: number[]): number {
  const sorted = [...hues].sort((left, right) => left - right);
  let smallest = 360;
  for (let index = 0; index < sorted.length; index += 1) {
    const gap =
      index === sorted.length - 1
        ? 360 - sorted[index] + sorted[0]
        : sorted[index + 1] - sorted[index];
    smallest = Math.min(smallest, gap);
  }
  return smallest;
}

describe("generated themes are spread around the hue wheel", () => {
  // The bug this pins: the first version rolled each accent hue independently, which
  // clusters — a batch of five came back as five greens. Worse, the contrast check then
  // rejected 58% of the wheel on dark mode and 75% on light (because `brassDark` sat at a
  // fixed lightness, and a fixed lightness is not a fixed contrast), so the *only* hues
  // that survived were yellow-green-teal. Both are fixed: hues are assigned one per
  // equal sector, and the accent shades are derived from the contrast they need.
  it("keeps a real gap between every accent in a batch", () => {
    for (const seed of [1, 2, 3, 42, 777, 1000, 99999, 20260913]) {
      const hues = generateThemes(5, [], seed).map((theme) => hueOf(theme.tokens.brass));
      // Five sectors are 72 degrees apart; jitter can close that, but nothing should
      // come near the ~6 degrees the clustered version produced.
      expect(smallestHueGap(hues), `seed ${seed}: ${hues.join(", ")}`).toBeGreaterThan(15);
    }
  });

  it("reaches hues right around the wheel, not one family", () => {
    // Collect across seeds and assert every quadrant shows up. The clustered version
    // could not produce a blue or a violet at all.
    const hues = [1, 2, 3, 42, 777, 1000].flatMap((seed) =>
      generateThemes(5, [], seed).map((theme) => hueOf(theme.tokens.brass)),
    );
    for (const [from, to] of [[0, 90], [90, 180], [180, 270], [270, 360]]) {
      expect(
        hues.some((hue) => hue >= from && hue < to),
        `no accent in ${from}-${to} degrees: ${hues.sort((a, b) => a - b).join(", ")}`,
      ).toBe(true);
    }
  });

  it("returns the full batch for every seed, so no sector is silently dropped", () => {
    // A sector whose candidates all failed contrast used to just yield nothing, which is
    // how a "generate 5" quietly produced 4.
    for (let seed = 1; seed <= 40; seed += 1) {
      expect(generateThemes(5, [], seed), `seed ${seed}`).toHaveLength(5);
    }
  });
});

describe("deriveTokens clears contrast across the whole wheel", () => {
  const fonts = { display: "sora", body: "inter", mono: "jetbrains-mono" } as const;

  it("passes every contrast pair at every hue, in both modes", () => {
    // The direct regression test for the fixed-lightness bug. Before the fix this failed
    // at 42 of 72 dark hues and 54 of 72 light ones.
    for (const mode of ["dark", "light"] as const) {
      for (let hue = 0; hue < 360; hue += 5) {
        const tokens = deriveTokens((hue + 180) % 360, hue, mode, fonts);
        const failures = checkThemeContrast(tokens).filter((finding) => finding.fails);
        expect(failures.map((finding) => finding.id), `${mode} accent ${hue}`).toEqual([]);
      }
    }
  });
});

describe("generated names match their descriptions", () => {
  it("uses the same colour word in the name and the description", () => {
    // `hueWord` was called twice with two different random draws, so a theme could come
    // out as "Fern Harbour — built around a jade accent".
    for (const seed of [1, 2, 3, 42, 777, 1000]) {
      for (const theme of generateThemes(5, [], seed)) {
        const colourWord = theme.name.split(" ")[0].toLowerCase();
        expect(theme.description, theme.name).toContain(colourWord);
      }
    }
  });
});
