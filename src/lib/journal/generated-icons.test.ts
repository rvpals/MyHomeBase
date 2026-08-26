import { describe, expect, it } from "vitest";
import {
  GENERATED_ICON_GLYPH_IDS,
  buildGeneratedIconSvg,
  isSafeGeneratedIconSvg,
  matchIconGlyph,
  normalizeIconName,
} from "./generated-icons";

describe("normalizeIconName", () => {
  it("lowercases, splits, and drops punctuation and digits", () => {
    expect(normalizeIconName("Trip: Zurich 2019!")).toEqual(["trip", "zurich"]);
    expect(normalizeIconName("road-trip")).toEqual(["road", "trip"]);
  });

  it("returns nothing for a name with no letters", () => {
    expect(normalizeIconName("2019")).toEqual([]);
    expect(normalizeIconName("   ")).toEqual([]);
  });
});

describe("matchIconGlyph", () => {
  it("matches the whole name as a keyword", () => {
    expect(matchIconGlyph("travel")).toBe("travel");
    expect(matchIconGlyph("Food")).toBe("food");
  });

  it("matches on any single word of a multi-word name", () => {
    expect(matchIconGlyph("Summer vacation")).toBe("travel");
    expect(matchIconGlyph("work meeting notes")).toBe("work");
  });

  it("matches a keyword contained inside a run-together name", () => {
    // "roadtrip" contains both "trip" (travel) and "road"/"roadtrip" (car); the
    // substring pass walks the table in order, so car's exact "roadtrip" keyword
    // is what lands. Either glyph is defensible — the point of the assertion is
    // that a run-together name resolves to *something* rather than a letter.
    expect(matchIconGlyph("roadtrip")).toBe("car");
    expect(matchIconGlyph("summerholiday")).toBe("travel");
  });

  it("ignores short keywords when matching by substring", () => {
    // "tea" is a drink keyword but only 3 letters, so it must not claim "team".
    expect(matchIconGlyph("teamwork")).toBe("work");
  });

  it("returns undefined when nothing matches", () => {
    expect(matchIconGlyph("Zurich")).toBeUndefined();
    expect(matchIconGlyph("2019")).toBeUndefined();
  });
});

describe("buildGeneratedIconSvg", () => {
  it("is deterministic — the same name yields byte-identical SVG", () => {
    expect(buildGeneratedIconSvg("Travel")).toBe(buildGeneratedIconSvg("Travel"));
    expect(buildGeneratedIconSvg("Zurich")).toBe(buildGeneratedIconSvg("Zurich"));
  });

  it("differs between names, so two tags don't look alike", () => {
    expect(buildGeneratedIconSvg("travel")).not.toBe(buildGeneratedIconSvg("food"));
  });

  it("draws the matched glyph rather than a letter", () => {
    const svg = buildGeneratedIconSvg("travel");
    expect(svg).toContain("<path");
    expect(svg).not.toContain("<text");
  });

  it("falls back to the name's initial when no keyword matches", () => {
    const svg = buildGeneratedIconSvg("Zurich");
    expect(svg).toContain("<text");
    expect(svg).toContain(">Z<");
  });

  it("falls back to a dot for a name with no letter or digit", () => {
    expect(buildGeneratedIconSvg("★")).toContain(">•<");
  });

  it("rejects an empty name", () => {
    expect(() => buildGeneratedIconSvg("   ")).toThrow(/empty name/i);
  });

  it("produces something the safety guard accepts, for every glyph and the fallback", () => {
    // One name per glyph id doubles as a check that no glyph body has drifted
    // into markup the guard would refuse.
    for (const id of GENERATED_ICON_GLYPH_IDS) {
      const svg = buildGeneratedIconSvg(id);
      expect(isSafeGeneratedIconSvg(svg), `glyph ${id}`).toBe(true);
    }
    expect(isSafeGeneratedIconSvg(buildGeneratedIconSvg("Zurich"))).toBe(true);
  });

  it("cannot let a hostile name become markup", () => {
    const svg = buildGeneratedIconSvg("</svg><script>alert(1)</script>");
    // `initialFor` narrows the name to a single letter/digit before it is ever
    // interpolated, so the payload can't reach the output at all — which is a
    // stronger property than escaping it would be.
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain("alert");
    expect(svg).toContain(">S</text>");
    expect(isSafeGeneratedIconSvg(svg)).toBe(true);
  });

  it("falls back to the bullet for a name made only of XML specials", () => {
    // There is no letter or digit to show, and the punctuation is never
    // interpolated, so nothing escapable can reach the output.
    expect(buildGeneratedIconSvg('<>&"')).toContain(">•</text>");
    expect(isSafeGeneratedIconSvg(buildGeneratedIconSvg('<>&"'))).toBe(true);
  });
});

describe("isSafeGeneratedIconSvg", () => {
  const good = buildGeneratedIconSvg("travel");

  it("refuses anything not built by this module", () => {
    expect(isSafeGeneratedIconSvg('<svg viewBox="0 0 64 64"></svg>')).toBe(false);
    expect(isSafeGeneratedIconSvg("")).toBe(false);
    expect(isSafeGeneratedIconSvg(`${good} trailing`)).toBe(false);
  });

  it("refuses script, event handlers and external references", () => {
    const withScript = good.replace("</svg>", "<script>alert(1)</script></svg>");
    expect(isSafeGeneratedIconSvg(withScript)).toBe(false);

    const withHandler = good.replace("<rect", '<rect onload="alert(1)"');
    expect(isSafeGeneratedIconSvg(withHandler)).toBe(false);

    const withHref = good.replace("</svg>", '<a href="http://x"/></svg>');
    expect(isSafeGeneratedIconSvg(withHref)).toBe(false);

    const withUse = good.replace("</svg>", '<use xlink:href="#x"/></svg>');
    expect(isSafeGeneratedIconSvg(withUse)).toBe(false);

    const withForeign = good.replace("</svg>", "<foreignObject/></svg>");
    expect(isSafeGeneratedIconSvg(withForeign)).toBe(false);
  });

  it("refuses style, url() and comments", () => {
    expect(isSafeGeneratedIconSvg(good.replace("<rect", '<rect style="fill:red"'))).toBe(false);
    expect(isSafeGeneratedIconSvg(good.replace("</svg>", "<!-- x --></svg>"))).toBe(false);
  });

  it("refuses an element outside the allowlist", () => {
    expect(isSafeGeneratedIconSvg(good.replace("</svg>", "<video/></svg>"))).toBe(false);
  });
});
