import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCRIPT_FONT,
  SCRIPT_FONTS,
  SCRIPT_FONT_SETTING_KEYS,
  getScriptFont,
  resolveScriptFont,
  scriptFontCssVar,
} from "./script-fonts";

describe("SCRIPT_FONTS", () => {
  it("offers every face under a unique id", () => {
    const ids = SCRIPT_FONTS.map((font) => font.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("points every face at a distinct CSS variable", () => {
    // Two faces sharing a variable would make one of them unselectable in
    // practice — the picker would offer a choice that changes nothing.
    const vars = SCRIPT_FONTS.map((font) => font.cssVar);
    expect(new Set(vars).size).toBe(vars.length);
  });

  it("names a --font- variable for each face", () => {
    // The seam with layout.tsx: these strings are written into a style block as
    // `var(…)`, so a malformed one silently drops the surface's font-family.
    SCRIPT_FONTS.forEach((font) => {
      expect(font.cssVar).toMatch(/^--font-[a-z-]+$/);
    });
  });

  it("gives every face a label and a description", () => {
    SCRIPT_FONTS.forEach((font) => {
      expect(font.label.length).toBeGreaterThan(0);
      expect(font.description.length).toBeGreaterThan(0);
    });
  });

  it("includes the default as a real catalogue entry", () => {
    expect(SCRIPT_FONTS.some((font) => font.id === DEFAULT_SCRIPT_FONT)).toBe(true);
  });

  it("keeps Great Vibes as the default, matching what both surfaces wore before", () => {
    // Changing this changes the look of every install that never picked a face,
    // including on upgrade. It should be a deliberate edit, not a drive-by.
    expect(DEFAULT_SCRIPT_FONT).toBe("great-vibes");
  });
});

describe("resolveScriptFont", () => {
  it("returns a stored face that is still in the catalogue", () => {
    expect(resolveScriptFont("caveat")).toBe("caveat");
    expect(resolveScriptFont("kalam")).toBe("kalam");
  });

  it("falls back to the default for an unknown id", () => {
    // A hand-edited settings row, or a face removed from the catalogue after
    // someone had picked it.
    expect(resolveScriptFont("comic-sans")).toBe(DEFAULT_SCRIPT_FONT);
  });

  it("falls back to the default for a missing or empty value", () => {
    expect(resolveScriptFont(undefined)).toBe(DEFAULT_SCRIPT_FONT);
    expect(resolveScriptFont(null)).toBe(DEFAULT_SCRIPT_FONT);
    expect(resolveScriptFont("")).toBe(DEFAULT_SCRIPT_FONT);
  });
});

describe("scriptFontCssVar", () => {
  it("returns the variable belonging to a known face", () => {
    expect(scriptFontCssVar("caveat")).toBe("--font-caveat");
    expect(scriptFontCssVar("pinyon-script")).toBe("--font-pinyon-script");
  });

  it("returns the default face's variable for anything unrecognised", () => {
    expect(scriptFontCssVar("nope")).toBe("--font-great-vibes");
    expect(scriptFontCssVar(undefined)).toBe("--font-great-vibes");
  });
});

describe("getScriptFont", () => {
  it("looks up a face by id", () => {
    expect(getScriptFont("great-vibes")?.label).toBe("Great Vibes");
  });

  it("returns undefined for an unknown id rather than guessing", () => {
    // Unlike resolveScriptFont, this one is for display and should not invent a
    // face the caller did not ask for.
    expect(getScriptFont("nope")).toBeUndefined();
  });
});

describe("SCRIPT_FONT_SETTING_KEYS", () => {
  it("matches the keys migrations/0137 seeds", () => {
    // These strings are the contract with the migration and with defaults.ts.
    expect(SCRIPT_FONT_SETTING_KEYS.dailyQuote).toBe("daily_quote_font");
    expect(SCRIPT_FONT_SETTING_KEYS.journalHandwriting).toBe("journal_handwriting_font");
  });
});
