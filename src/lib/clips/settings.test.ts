import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLIP_EXCERPT_CHARS,
  MAX_CLIP_EXCERPT_CHARS,
  MIN_CLIP_EXCERPT_CHARS,
  clipExcerptCharsSchema,
  resolveClipsSettings,
} from "./settings";
import { CLIPS_SETTING_KEYS } from "./settings";

describe("resolveClipsSettings", () => {
  it("defaults when the module has no settings rows", () => {
    expect(resolveClipsSettings([])).toEqual({ excerptChars: DEFAULT_CLIP_EXCERPT_CHARS });
  });

  it("reads a stored value", () => {
    const settings = resolveClipsSettings([
      { key: CLIPS_SETTING_KEYS.excerptChars, value: "450" },
    ]);
    expect(settings.excerptChars).toBe(450);
  });

  it("ignores rows belonging to other settings", () => {
    const settings = resolveClipsSettings([
      { key: "something_else", value: "999" },
      { key: CLIPS_SETTING_KEYS.excerptChars, value: "120" },
    ]);
    expect(settings.excerptChars).toBe(120);
  });

  it("clamps a stored value that is out of range", () => {
    // A row can be hand-edited in the database, or left behind by an older build
    // with different bounds. The read must land inside the range either way.
    expect(
      resolveClipsSettings([{ key: CLIPS_SETTING_KEYS.excerptChars, value: "999999" }])
        .excerptChars,
    ).toBe(MAX_CLIP_EXCERPT_CHARS);

    expect(
      resolveClipsSettings([{ key: CLIPS_SETTING_KEYS.excerptChars, value: "1" }]).excerptChars,
    ).toBe(MIN_CLIP_EXCERPT_CHARS);
  });

  it("falls back to the default for a corrupt value rather than throwing", () => {
    // A page that only wanted to draw some cards must not crash on a bad row.
    for (const value of ["", "   ", "abc", "NaN"]) {
      expect(
        resolveClipsSettings([{ key: CLIPS_SETTING_KEYS.excerptChars, value }]).excerptChars,
      ).toBe(DEFAULT_CLIP_EXCERPT_CHARS);
    }
  });
});

describe("clipExcerptCharsSchema", () => {
  it("accepts a number inside the range", () => {
    expect(clipExcerptCharsSchema.parse(300)).toBe(300);
  });

  it("coerces the string a number input submits", () => {
    expect(clipExcerptCharsSchema.parse("512")).toBe(512);
  });

  it("clamps rather than refusing, at both ends", () => {
    // A reader dragging past the end of the range has said "as much as possible",
    // and an error message is a worse answer to that than the maximum.
    expect(clipExcerptCharsSchema.parse(10)).toBe(MIN_CLIP_EXCERPT_CHARS);
    expect(clipExcerptCharsSchema.parse(100000)).toBe(MAX_CLIP_EXCERPT_CHARS);
  });

  it("defaults a value that is not a number at all", () => {
    expect(clipExcerptCharsSchema.parse("not a number")).toBe(DEFAULT_CLIP_EXCERPT_CHARS);
    expect(clipExcerptCharsSchema.parse(null)).toBe(DEFAULT_CLIP_EXCERPT_CHARS);
  });

  it("keeps the ceiling at or under the repository's bounded prefix", () => {
    // The ceiling is pinned to EXCERPT_SOURCE_CHARS in repository.ts: letting the
    // setting exceed the prefix read in SQL would silently re-introduce the
    // full-column read that bounded prefix exists to avoid.
    expect(MAX_CLIP_EXCERPT_CHARS).toBeLessThanOrEqual(2000);
  });
});
