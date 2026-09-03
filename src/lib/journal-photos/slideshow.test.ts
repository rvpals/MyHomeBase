import { describe, expect, it } from "vitest";
import {
  DEFAULT_SLIDESHOW_OPTIONS,
  SLIDESHOW_EFFECT_CHOICES,
  SLIDESHOW_INTERVAL_CHOICES,
  normaliseSlideshowOptions,
  slideshowIntervalMs,
} from "./slideshow";

describe("DEFAULT_SLIDESHOW_OPTIONS", () => {
  it("is itself a selectable combination", () => {
    // A default that is not on the menu shows a `<select>` with nothing selected, which
    // then silently displays its first option instead -- the bug this test exists for.
    expect(SLIDESHOW_INTERVAL_CHOICES).toContain(DEFAULT_SLIDESHOW_OPTIONS.intervalSeconds);
    expect(SLIDESHOW_EFFECT_CHOICES.map((choice) => choice.value)).toContain(
      DEFAULT_SLIDESHOW_OPTIONS.effect,
    );
  });

  it("starts with no transition", () => {
    expect(DEFAULT_SLIDESHOW_OPTIONS.effect).toBe("none");
  });
});

describe("slideshowIntervalMs", () => {
  it("converts seconds to milliseconds", () => {
    expect(slideshowIntervalMs({ intervalSeconds: 5, effect: "none" })).toBe(5000);
    expect(slideshowIntervalMs({ intervalSeconds: 30, effect: "fade" })).toBe(30000);
  });
});

describe("normaliseSlideshowOptions", () => {
  it("keeps values that are on the menu", () => {
    expect(normaliseSlideshowOptions({ intervalSeconds: 10, effect: "fade" })).toEqual({
      intervalSeconds: 10,
      effect: "fade",
    });
  });

  it("accepts the numeric strings a <select> hands back", () => {
    expect(normaliseSlideshowOptions({ intervalSeconds: "15", effect: "slide" })).toEqual({
      intervalSeconds: 15,
      effect: "slide",
    });
  });

  it("falls back to the default for an interval that is not offered", () => {
    // 7 is harmless but cannot be shown as selected; 0 would make the slideshow useless.
    expect(normaliseSlideshowOptions({ intervalSeconds: 7 }).intervalSeconds).toBe(5);
    expect(normaliseSlideshowOptions({ intervalSeconds: 0 }).intervalSeconds).toBe(5);
    expect(normaliseSlideshowOptions({ intervalSeconds: -10 }).intervalSeconds).toBe(5);
  });

  it("falls back to the default for an unknown effect", () => {
    expect(normaliseSlideshowOptions({ effect: "explode" }).effect).toBe("none");
  });

  it("returns the defaults for empty, junk and missing input", () => {
    // Total by design: a slideshow is not worth failing over, so nothing here throws.
    expect(normaliseSlideshowOptions({})).toEqual(DEFAULT_SLIDESHOW_OPTIONS);
    expect(normaliseSlideshowOptions({ intervalSeconds: null, effect: undefined })).toEqual(
      DEFAULT_SLIDESHOW_OPTIONS,
    );
    expect(normaliseSlideshowOptions({ intervalSeconds: "soon", effect: 42 })).toEqual(
      DEFAULT_SLIDESHOW_OPTIONS,
    );
  });
});
