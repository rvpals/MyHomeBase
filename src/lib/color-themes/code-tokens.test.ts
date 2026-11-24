import { describe, expect, it } from "vitest";
import { COLOR_THEMES, type ColorThemeTokens } from "@/lib/settings";
import { codeTokensToCss, deriveCodeTokens, type CodeTokens } from "./code-tokens";
import { CONTRAST_AA_TEXT, contrastRatio } from "./contrast";

const ROLES: (keyof CodeTokens)[] = [
  "keyword",
  "string",
  "number",
  "entity",
  "comment",
  "punctuation",
];

/** A theme's tokens with one field overridden, for the edge cases below. */
function themeWith(over: Partial<ColorThemeTokens>): ColorThemeTokens {
  return { ...COLOR_THEMES[0].tokens, ...over };
}

describe("deriveCodeTokens", () => {
  // The load-bearing test for the whole scheme. Nobody picks these colours, so
  // nobody is going to notice an unreadable one on a theme they do not use —
  // this is the only thing standing between a new theme and illegible code.
  it.each(COLOR_THEMES.map((theme) => [theme.id, theme.tokens] as const))(
    "clears AA against paper for every role on %s",
    (_id, tokens) => {
      const code = deriveCodeTokens(tokens);

      for (const role of ROLES) {
        const ratio = contrastRatio(code[role], tokens.paper) ?? 0;
        expect(ratio, `${role} on ${tokens.paper}`).toBeGreaterThanOrEqual(CONTRAST_AA_TEXT);
      }
    },
  );

  it("returns six parseable hex colours", () => {
    const code = deriveCodeTokens(COLOR_THEMES[0].tokens);
    for (const role of ROLES) {
      expect(code[role], role).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it("keeps keyword, string and number visibly distinct", () => {
    // The point of the hue offsets. If these collapse, the palette is a
    // monochrome one wearing a more expensive implementation.
    const code = deriveCodeTokens(COLOR_THEMES[0].tokens);
    expect(new Set([code.keyword, code.string, code.number]).size).toBe(3);
  });

  it("answers for a light theme as well as a dark one", () => {
    // Two of the built-ins are light, and the search has to walk *darker* there.
    // A palette derived the dark way round would fail every role on them.
    const light = themeWith({ paper: "#FFFFFF", brass: "#B8860B" });
    const code = deriveCodeTokens(light);

    for (const role of ROLES) {
      const ratio = contrastRatio(code[role], light.paper) ?? 0;
      expect(ratio, role).toBeGreaterThanOrEqual(CONTRAST_AA_TEXT);
    }
  });

  it("still answers when the accent is not a parseable hex", () => {
    // A hand-edited row in the themes table. The page must render — a dull
    // palette beats a crash in a layout.
    const broken = themeWith({ brass: "not-a-colour" });
    const code = deriveCodeTokens(broken);

    for (const role of ROLES) {
      expect(code[role], role).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it("does not loop forever on a mid-tone background nothing can clear", () => {
    // A 50%-grey page: no colour at any lightness clears 4.5:1 against it. The
    // search must give up and return its best effort rather than spin.
    const midGrey = themeWith({ paper: "#767676" });
    const code = deriveCodeTokens(midGrey);

    for (const role of ROLES) {
      expect(code[role], role).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});

describe("codeTokensToCss", () => {
  it("emits one custom property per role", () => {
    const css = codeTokensToCss(deriveCodeTokens(COLOR_THEMES[0].tokens));

    for (const role of ROLES) {
      expect(css).toContain(`--code-${role === "entity" ? "entity" : role}:`);
    }
    // Semicolon-joined and with no trailing one — it is spliced into a longer
    // `:root{…}` string that supplies its own separators.
    expect(css.endsWith(";")).toBe(false);
  });
});
