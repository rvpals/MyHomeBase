import { describe, expect, it } from "vitest";
import {
  CONTENT_SIZE_OPTIONS,
  DEFAULT_JOURNAL_CONTENT_TEXTURE_OPACITY,
  HANDWRITING_SIZE_OPTIONS,
  JOURNAL_SETTING_KEYS,
  NO_JOURNAL_CONTENT_TEXTURE,
  contentFontFamily,
  contentSizeClass,
  handwritingSizeClass,
  journalPreferencesToEntries,
  nextContentSizeUp,
  resolveJournalContentTexture,
  resolveJournalContentTextureOpacity,
  resolveJournalPreferences,
} from "./preferences";
import type { DashboardTextureItem } from "@/lib/dashboard-texture";
import type { ModuleSetting } from "@/lib/module-settings";
import type { JournalHandwritingSize } from "./types";

function setting(key: string, value: string): ModuleSetting {
  return { id: 1, moduleId: 3, key, value };
}

describe("resolveJournalPreferences", () => {
  it("defaults to fahrenheit and no location when nothing is set", () => {
    expect(resolveJournalPreferences([])).toEqual({
      defaultLocation: null,
      temperatureUnit: "fahrenheit",
      photoRoot: "",
      handwritingSize: "xl",
      reviewBeforeCalendarImport: false,
      topicMatchBody: false,
      topicEpisodeGapDays: 14,
      excludedWords: [],
      contentTextureId: null,
      contentTextureOpacity: 0.1,
      contentTextColor: null,
      contentFont: null,
      contentFontSize: "sm",
    });
  });

  it("reads a default location and unit", () => {
    const prefs = resolveJournalPreferences([
      setting(JOURNAL_SETTING_KEYS.defaultLatitude, "40.34"),
      setting(JOURNAL_SETTING_KEYS.defaultLongitude, "-74.46"),
      setting(JOURNAL_SETTING_KEYS.defaultLocationName, "Princeton, NJ"),
      setting(JOURNAL_SETTING_KEYS.temperatureUnit, "celsius"),
    ]);
    expect(prefs).toEqual({
      defaultLocation: { latitude: 40.34, longitude: -74.46, name: "Princeton, NJ" },
      temperatureUnit: "celsius",
      photoRoot: "",
      handwritingSize: "xl",
      reviewBeforeCalendarImport: false,
      topicMatchBody: false,
      topicEpisodeGapDays: 14,
      excludedWords: [],
      contentTextureId: null,
      contentTextureOpacity: 0.1,
      contentTextColor: null,
      contentFont: null,
      contentFontSize: "sm",
    });
  });

  it("reads and normalizes the excluded-word list", () => {
    const prefs = resolveJournalPreferences([
      setting(JOURNAL_SETTING_KEYS.excludedWords, "Beach, picnic ,beach,,it"),
    ]);
    // Deduped, lowercased, and "it" dropped for being under the length floor.
    expect(prefs.excludedWords).toEqual(["beach", "picnic"]);
  });

  it("ignores a partial/invalid location", () => {
    const prefs = resolveJournalPreferences([setting(JOURNAL_SETTING_KEYS.defaultLatitude, "40.34")]);
    expect(prefs.defaultLocation).toBeNull();
  });
});

describe("journalPreferencesToEntries", () => {
  it("writes the excluded words as one comma-joined row", () => {
    const entries = journalPreferencesToEntries({
      defaultLocation: null,
      temperatureUnit: "fahrenheit",
      photoRoot: "",
      handwritingSize: "xl",
      reviewBeforeCalendarImport: false,
      topicMatchBody: false,
      topicEpisodeGapDays: 14,
      excludedWords: ["Beach", "picnic"],
      contentTextureId: null,
      contentTextureOpacity: 0.1,
      contentTextColor: null,
      contentFont: null,
      contentFontSize: "sm",
    });
    const row = entries.find((entry) => entry.key === JOURNAL_SETTING_KEYS.excludedWords);
    expect(row?.value).toBe("beach,picnic");
  });

  it("omits the excluded-words row entirely when the list is empty", () => {
    const entries = journalPreferencesToEntries({
      defaultLocation: null,
      temperatureUnit: "fahrenheit",
      photoRoot: "",
      handwritingSize: "xl",
      reviewBeforeCalendarImport: false,
      topicMatchBody: false,
      topicEpisodeGapDays: 14,
      excludedWords: [],
      contentTextureId: null,
      contentTextureOpacity: 0.1,
      contentTextColor: null,
      contentFont: null,
      contentFontSize: "sm",
    });
    // A blank value would be rejected by the module-settings schema, so the
    // empty list has to mean "no row".
    expect(entries.some((entry) => entry.key === JOURNAL_SETTING_KEYS.excludedWords)).toBe(false);
    expect(entries.every((entry) => entry.value !== "")).toBe(true);
  });

  it("omits a blank location name (module-setting values must be non-empty)", () => {
    const entries = journalPreferencesToEntries({
      defaultLocation: { latitude: 1, longitude: 2, name: "" },
      temperatureUnit: "fahrenheit",
      photoRoot: "",
      handwritingSize: "xl",
      reviewBeforeCalendarImport: false,
      topicMatchBody: false,
      topicEpisodeGapDays: 14,
      excludedWords: [],
      contentTextureId: null,
      contentTextureOpacity: 0.1,
      contentTextColor: null,
      contentFont: null,
      contentFontSize: "sm",
    });
    expect(entries.some((entry) => entry.key === JOURNAL_SETTING_KEYS.defaultLocationName)).toBe(false);
    expect(entries.every((entry) => entry.value !== "")).toBe(true);
  });

  it("round-trips through resolve", () => {
    const original = {
      defaultLocation: { latitude: 12.5, longitude: -70.25, name: "Somewhere" },
      temperatureUnit: "celsius" as const,
      // A path with a space, which is what the real archive uses.
      photoRoot: "/volume1/MEDIA/PHOTO/BY YEAR",
      // Not the default, so the round-trip proves the value is actually carried
      // rather than being reconstructed by the fallback.
      handwritingSize: "3xl" as const,
      // Not the default either, for the same reason.
      reviewBeforeCalendarImport: true,
      topicMatchBody: false,
      topicEpisodeGapDays: 14,
      // Non-empty for the same reason as the two above: a round-trip through an
      // empty list would also pass if the field were dropped entirely, so it
      // would prove nothing. Two words rather than one so the serializer's
      // separator handling is exercised as well.
      excludedWords: ["the", "and"],
      // Non-default for the same reason as the three above: a round-trip
      // through `null` would also pass if the field were dropped entirely.
      contentTextureId: 7,
      // Not the default, so the round-trip proves it is carried.
      contentTextureOpacity: 0.45,
      contentTextColor: "#1A2B3C",
      // Both non-default, for the same reason as the fields above: a round-trip
      // through the fallback would also pass if the field were dropped.
      // `as const` for the same reason `temperatureUnit` above has it — this
      // object carries no annotation, so a bare string widens and no longer
      // satisfies the union.
      contentFont: "inter" as const,
      contentFontSize: "lg" as const,
    };
    const rebuilt = resolveJournalPreferences(
      journalPreferencesToEntries(original).map((entry, index) => ({
        id: index + 1,
        moduleId: 3,
        key: entry.key,
        value: entry.value,
      })),
    );
    expect(rebuilt).toEqual(original);
  });

  it("omits the photo root when blank, and trims it when set", () => {
    // Blank must not be stored: module-setting values have to be non-empty, and an
    // absent row is what "not configured" means on read.
    expect(
      journalPreferencesToEntries({
        defaultLocation: null,
        temperatureUnit: "fahrenheit",
        photoRoot: "   ",
        handwritingSize: "xl",
        reviewBeforeCalendarImport: false,
        topicMatchBody: false,
        topicEpisodeGapDays: 14,
        excludedWords: [],
        contentTextureId: null,
        contentTextureOpacity: 0.1,
        contentTextColor: null,
        contentFont: null,
        contentFontSize: "sm",
      }).some((entry) => entry.key === JOURNAL_SETTING_KEYS.photoRoot),
    ).toBe(false);

    // A pasted path often carries surrounding whitespace, which is invisible in the
    // field but would make the folder unreachable.
    const entries = journalPreferencesToEntries({
      defaultLocation: null,
      temperatureUnit: "fahrenheit",
      photoRoot: "  /volume1/MEDIA/PHOTO/BY YEAR  ",
      handwritingSize: "xl",
      reviewBeforeCalendarImport: false,
      topicMatchBody: false,
      topicEpisodeGapDays: 14,
      excludedWords: [],
      contentTextureId: null,
      contentTextureOpacity: 0.1,
      contentTextColor: null,
      contentFont: null,
      contentFontSize: "sm",
    });
    expect(entries.find((entry) => entry.key === JOURNAL_SETTING_KEYS.photoRoot)?.value).toBe(
      "/volume1/MEDIA/PHOTO/BY YEAR",
    );
  });

  it("reads a stored photo root, preserving its internal spaces", () => {
    const prefs = resolveJournalPreferences([
      setting(JOURNAL_SETTING_KEYS.photoRoot, "  /volume1/MEDIA/PHOTO/BY YEAR  "),
    ]);
    expect(prefs.photoRoot).toBe("/volume1/MEDIA/PHOTO/BY YEAR");
  });
});

describe("handwriting size", () => {
  it("reads every offered size back as itself", () => {
    for (const option of HANDWRITING_SIZE_OPTIONS) {
      const prefs = resolveJournalPreferences([
        setting(JOURNAL_SETTING_KEYS.handwritingSize, option.value),
      ]);
      expect(prefs.handwritingSize, `stored ${option.value}`).toBe(option.value);
    }
  });

  it("falls back to the 20px floor for a value it does not offer", () => {
    // The failure path that matters: the stored value becomes a CSS class, so a
    // hand-edited row, or one written by a build that offered a size this one
    // doesn't, must not reach the DOM as `text-xs` or as no size at all.
    for (const bogus of ["xs", "sm", "base", "9xl", "20px", "", "Small"]) {
      const prefs = resolveJournalPreferences([
        setting(JOURNAL_SETTING_KEYS.handwritingSize, bogus),
      ]);
      expect(prefs.handwritingSize, `stored ${JSON.stringify(bogus)}`).toBe("xl");
    }
  });

  it("never offers a size below the font-script floor design.md sets", () => {
    // Guards the rule itself rather than one call site: the floor is 20px, and the
    // smallest offered option is what enforces it.
    expect(Math.min(...HANDWRITING_SIZE_OPTIONS.map((option) => option.px))).toBe(20);
  });

  it("maps every offered size to a distinct literal Tailwind class", () => {
    // Literal, because Tailwind compiles classes ahead of time — an interpolated
    // `text-[...]` would emit no CSS and the field would silently lose its size.
    const classes = HANDWRITING_SIZE_OPTIONS.map((option) => option.className);
    expect(new Set(classes).size).toBe(HANDWRITING_SIZE_OPTIONS.length);
    for (const option of HANDWRITING_SIZE_OPTIONS) {
      expect(handwritingSizeClass(option.value)).toBe(option.className);
    }
  });

  it("falls back to the default class for an unrecognised size", () => {
    expect(handwritingSizeClass("xs" as JournalHandwritingSize)).toBe("text-xl");
  });

  it("always writes a size row, since the value has no 'unset' member", () => {
    const entries = journalPreferencesToEntries({
      defaultLocation: null,
      temperatureUnit: "fahrenheit",
      photoRoot: "",
      handwritingSize: "2xl",
      reviewBeforeCalendarImport: false,
      topicMatchBody: false,
      topicEpisodeGapDays: 14,
      excludedWords: [],
      contentTextureId: null,
      contentTextureOpacity: 0.1,
      contentTextColor: null,
      contentFont: null,
      contentFontSize: "sm",
    });
    expect(entries.find((entry) => entry.key === JOURNAL_SETTING_KEYS.handwritingSize)?.value).toBe(
      "2xl",
    );
  });
});

describe("topic match body", () => {
  it("defaults to off when no row is stored", () => {
    // Body matching widens a topic into incidental mentions, so it has to be
    // asked for rather than arrive switched on.
    expect(resolveJournalPreferences([]).topicMatchBody).toBe(false);
  });

  it("reads a stored 'true' as on", () => {
    const prefs = resolveJournalPreferences([setting(JOURNAL_SETTING_KEYS.topicMatchBody, "true")]);
    expect(prefs.topicMatchBody).toBe(true);
  });

  it("treats anything that isn't 'true' as off", () => {
    for (const stored of ["false", "1", "0", "yes", "", "TRUE", " true "]) {
      const prefs = resolveJournalPreferences([
        setting(JOURNAL_SETTING_KEYS.topicMatchBody, stored),
      ]);
      expect(prefs.topicMatchBody, `stored ${JSON.stringify(stored)}`).toBe(false);
    }
  });
});

describe("topic episode gap days", () => {
  it("defaults to a fortnight when no row is stored", () => {
    expect(resolveJournalPreferences([]).topicEpisodeGapDays).toBe(14);
  });

  it("reads a stored whole number", () => {
    const prefs = resolveJournalPreferences([
      setting(JOURNAL_SETTING_KEYS.topicEpisodeGapDays, "30"),
    ]);
    expect(prefs.topicEpisodeGapDays).toBe(30);
  });

  // The failure that motivated clamping rather than trusting: `Number("")` is
  // 0, an integer in range once clamped, so a blank row would otherwise read
  // as a one-day gap and give every entry its own episode.
  it("falls back to the default for a blank or unparseable row", () => {
    for (const stored of ["", "   ", "soon", "1.5"]) {
      const prefs = resolveJournalPreferences([
        setting(JOURNAL_SETTING_KEYS.topicEpisodeGapDays, stored),
      ]);
      expect(prefs.topicEpisodeGapDays, `stored ${JSON.stringify(stored)}`).toBe(14);
    }
  });

  it("clamps a hand-edited value into range", () => {
    const low = resolveJournalPreferences([setting(JOURNAL_SETTING_KEYS.topicEpisodeGapDays, "0")]);
    expect(low.topicEpisodeGapDays).toBe(1);

    const negative = resolveJournalPreferences([
      setting(JOURNAL_SETTING_KEYS.topicEpisodeGapDays, "-5"),
    ]);
    expect(negative.topicEpisodeGapDays).toBe(1);

    const high = resolveJournalPreferences([
      setting(JOURNAL_SETTING_KEYS.topicEpisodeGapDays, "99999"),
    ]);
    expect(high.topicEpisodeGapDays).toBe(365);
  });

  it("writes both Topics rows at every value, so a change sticks", () => {
    const entries = journalPreferencesToEntries({
      defaultLocation: null,
      temperatureUnit: "fahrenheit",
      photoRoot: "",
      handwritingSize: "xl",
      reviewBeforeCalendarImport: false,
      topicMatchBody: false,
      topicEpisodeGapDays: 30,
      excludedWords: [],
      contentTextureId: null,
      contentTextureOpacity: 0.1,
      contentTextColor: null,
      contentFont: null,
      contentFontSize: "sm",
    });

    expect(entries.find((entry) => entry.key === JOURNAL_SETTING_KEYS.topicMatchBody)?.value).toBe(
      "false",
    );
    expect(
      entries.find((entry) => entry.key === JOURNAL_SETTING_KEYS.topicEpisodeGapDays)?.value,
    ).toBe("30");
  });
});

describe("review before calendar import", () => {
  it("defaults to off when no row is stored", () => {
    // The import ran straight through before this preference existed, so an
    // install that has never saved it must keep behaving that way.
    expect(resolveJournalPreferences([]).reviewBeforeCalendarImport).toBe(false);
  });

  it("reads a stored 'true' as on", () => {
    const prefs = resolveJournalPreferences([
      setting(JOURNAL_SETTING_KEYS.reviewBeforeCalendarImport, "true"),
    ]);
    expect(prefs.reviewBeforeCalendarImport).toBe(true);
  });

  it("treats anything that isn't 'true' as off", () => {
    // A boolean kept as text has plenty of ways to arrive wrong. Reading
    // "anything non-empty" as true would turn a hand-edited "false" into a yes.
    for (const stored of ["false", "1", "0", "yes", "no", "", "TRUE", " true "]) {
      const prefs = resolveJournalPreferences([
        setting(JOURNAL_SETTING_KEYS.reviewBeforeCalendarImport, stored),
      ]);
      expect(prefs.reviewBeforeCalendarImport, `stored ${JSON.stringify(stored)}`).toBe(false);
    }
  });

  it("writes a row at both values, so unticking the box sticks", () => {
    // Only writing the `true` case would leave the old row in place on save, and
    // unticking would appear to do nothing until the settings were hand-edited.
    for (const enabled of [true, false]) {
      const entries = journalPreferencesToEntries({
        defaultLocation: null,
        temperatureUnit: "fahrenheit",
        photoRoot: "",
        handwritingSize: "xl",
        reviewBeforeCalendarImport: enabled,
        topicMatchBody: false,
        topicEpisodeGapDays: 14,
        // Empty: this test is about the review flag's row, and an irrelevant
        // non-empty value here would only add noise to what it asserts.
        excludedWords: [],
        contentTextureId: null,
        contentTextureOpacity: 0.1,
        contentTextColor: null,
        contentFont: null,
        contentFontSize: "sm",
      });
      expect(
        entries.find((entry) => entry.key === JOURNAL_SETTING_KEYS.reviewBeforeCalendarImport)
          ?.value,
        `enabled ${enabled}`,
      ).toBe(enabled ? "true" : "false");
    }
  });
});

describe("content background texture", () => {
  // A library row shaped like the real thing. Only `id`, `hasImage`, `opacity`
  // and `updatedAt` are read by the resolver; the rest are here so the fixture
  // type-checks against DashboardTextureItem.
  function texture(id: number, over: Partial<DashboardTextureItem> = {}): DashboardTextureItem {
    return {
      id,
      name: `Texture ${id}`,
      hasImage: true,
      opacity: 0.1,
      mode: "cover",
      blur: 0,
      updatedAt: "2026-10-21T00:00:00Z",
      ...over,
    };
  }

  it("reads a stored pointer back as the id", () => {
    const prefs = resolveJournalPreferences([
      setting(JOURNAL_SETTING_KEYS.contentTextureId, "12"),
    ]);
    expect(prefs.contentTextureId).toBe(12);
  });

  it("reads the no-texture sentinel, and anything malformed, as null", () => {
    // `"0"` is the sentinel the screen writes to clear the choice. The rest is
    // what a hand-edited row looks like — none of it may become a pointer, or
    // the field would render a layer whose URL 404s.
    for (const stored of [NO_JOURNAL_CONTENT_TEXTURE, "", "   ", "-1", "abc", "1.5", "NaN"]) {
      const prefs = resolveJournalPreferences([
        setting(JOURNAL_SETTING_KEYS.contentTextureId, stored),
      ]);
      expect(prefs.contentTextureId, `stored ${JSON.stringify(stored)}`).toBeNull();
    }
  });

  it("writes the sentinel rather than omitting the row when no texture is chosen", () => {
    const entries = journalPreferencesToEntries({
      defaultLocation: null,
      temperatureUnit: "fahrenheit",
      photoRoot: "",
      handwritingSize: "xl",
      reviewBeforeCalendarImport: false,
      topicMatchBody: false,
      topicEpisodeGapDays: 14,
      excludedWords: [],
      contentTextureId: null,
      contentTextureOpacity: 0.1,
      contentTextColor: null,
      contentFont: null,
      contentFontSize: "sm",
    });
    const row = entries.find((entry) => entry.key === JOURNAL_SETTING_KEYS.contentTextureId);
    expect(row?.value).toBe(NO_JOURNAL_CONTENT_TEXTURE);
    // The schema rejects blanks, which is why the sentinel exists at all.
    expect(entries.every((entry) => entry.value !== "")).toBe(true);
  });

  it("resolves a chosen picture to its URL and the journal's own opacity", () => {
    const resolved = resolveJournalContentTexture(
      4,
      [texture(3), texture(4, { opacity: 0.35 })],
      0.6,
    );
    expect(resolved?.backgroundImage).toBe(
      'url("/api/dashboard/texture?id=4&v=2026-10-21T00%3A00%3A00Z")',
    );
    // The journal's value wins over the library row's 0.35: a picture tuned
    // for whatever surface it last sat on is not tuned for this one.
    expect(resolved?.opacity).toBe(0.6);
  });

  it("clamps an out-of-range opacity handed straight to the resolver", () => {
    // The read path clamps too, but a caller can pass a raw number -- a slider
    // mid-drag, or a value from somewhere other than resolveJournalPreferences.
    expect(resolveJournalContentTexture(1, [texture(1)], 4)?.opacity).toBe(1);
    expect(resolveJournalContentTexture(1, [texture(1)], -2)?.opacity).toBe(0);
  });

  it("falls back to the default strength when the caller omits one", () => {
    expect(resolveJournalContentTexture(1, [texture(1)])?.opacity).toBe(
      DEFAULT_JOURNAL_CONTENT_TEXTURE_OPACITY,
    );
  });

  it("carries the library picture's own tile/cover mode through", () => {
    // Unlike the opacity, the mode is NOT overridden here: a picture marked
    // `tile` is one meant to repeat at its natural size, and stretching it
    // would be drawing it wrong rather than drawing it differently.
    expect(resolveJournalContentTexture(1, [texture(1, { mode: "tile" })])?.mode).toBe("tile");
    expect(resolveJournalContentTexture(1, [texture(1, { mode: "cover" })])?.mode).toBe("cover");
  });

  it("resolves to undefined when nothing is chosen", () => {
    expect(resolveJournalContentTexture(null, [texture(1)])).toBeUndefined();
  });

  it("resolves a stale pointer to undefined rather than a broken layer", () => {
    // The failure path that matters: there is no foreign key, so deleting a
    // library picture leaves this pointer behind. It has to fall through to the
    // plain sheet, not to a background-image that 404s.
    expect(resolveJournalContentTexture(99, [texture(1), texture(2)])).toBeUndefined();
    // Same for a row that exists but carries no image.
    expect(resolveJournalContentTexture(1, [texture(1, { hasImage: false })])).toBeUndefined();
  });
});

describe("content text color", () => {
  it("reads a stored hex back, normalized to upper case", () => {
    const prefs = resolveJournalPreferences([
      setting(JOURNAL_SETTING_KEYS.contentTextColor, "  #1a2b3c  "),
    ]);
    expect(prefs.contentTextColor).toBe("#1A2B3C");
  });

  it("falls back to the theme's ink for anything that is not #RRGGBB", () => {
    // The value reaches the DOM as a CSS color. A shorthand or a named color
    // would often *work*, which is worse than failing: the stored value would
    // no longer be the one shape the picker can round-trip.
    for (const bogus of ["", "   ", "#FFF", "red", "1A2B3C", "#12345G", "rgb(0,0,0)"]) {
      const prefs = resolveJournalPreferences([
        setting(JOURNAL_SETTING_KEYS.contentTextColor, bogus),
      ]);
      expect(prefs.contentTextColor, `stored ${JSON.stringify(bogus)}`).toBeNull();
    }
  });

  it("omits the row when unset, since an absent row means 'use the theme's ink'", () => {
    const entries = journalPreferencesToEntries({
      defaultLocation: null,
      temperatureUnit: "fahrenheit",
      photoRoot: "",
      handwritingSize: "xl",
      reviewBeforeCalendarImport: false,
      topicMatchBody: false,
      topicEpisodeGapDays: 14,
      excludedWords: [],
      contentTextureId: null,
      contentTextureOpacity: 0.1,
      contentTextColor: null,
      contentFont: null,
      contentFontSize: "sm",
    });
    expect(entries.some((entry) => entry.key === JOURNAL_SETTING_KEYS.contentTextColor)).toBe(
      false,
    );
    expect(entries.every((entry) => entry.value !== "")).toBe(true);
  });
});

describe("content texture strength", () => {
  it("reads a stored strength back as a number", () => {
    const prefs = resolveJournalPreferences([
      setting(JOURNAL_SETTING_KEYS.contentTextureOpacity, "0.45"),
    ]);
    expect(prefs.contentTextureOpacity).toBe(0.45);
  });

  it("falls back to the default for a blank or unparseable row", () => {
    // Free-form text with no CHECK behind it, so this is the only thing between
    // a hand-edited row and a Content field drawn at the wrong strength.
    for (const bogus of ["", "   ", "abc", "NaN"]) {
      expect(
        resolveJournalContentTextureOpacity(bogus),
        `stored ${JSON.stringify(bogus)}`,
      ).toBe(DEFAULT_JOURNAL_CONTENT_TEXTURE_OPACITY);
    }
    expect(resolveJournalContentTextureOpacity(undefined)).toBe(
      DEFAULT_JOURNAL_CONTENT_TEXTURE_OPACITY,
    );
  });

  it("clamps a stored strength to 0..1 rather than erroring", () => {
    // A bad preference must not break the form you write entries in.
    expect(resolveJournalContentTextureOpacity("40")).toBe(1);
    expect(resolveJournalContentTextureOpacity("-3")).toBe(0);
    // The edges themselves stay reachable.
    expect(resolveJournalContentTextureOpacity("0")).toBe(0);
    expect(resolveJournalContentTextureOpacity("1")).toBe(1);
  });

  it("always writes a strength row, and clamps it on the way out", () => {
    const entries = journalPreferencesToEntries({
      defaultLocation: null,
      temperatureUnit: "fahrenheit",
      photoRoot: "",
      handwritingSize: "xl",
      reviewBeforeCalendarImport: false,
      topicMatchBody: false,
      topicEpisodeGapDays: 14,
      excludedWords: [],
      contentTextureId: null,
      contentTextureOpacity: 2.5,
      contentTextColor: null,
      contentFont: null,
      contentFontSize: "sm",
    });
    // Written even with no texture chosen: the value has no "unset" member, so
    // a row is never ambiguous -- the same call the size and review flag make.
    expect(entries.find((entry) => entry.key === JOURNAL_SETTING_KEYS.contentTextureOpacity)
      ?.value).toBe("1");
  });
});

describe("content font and size", () => {
  it("reads a stored face back as itself", () => {
    const prefs = resolveJournalPreferences([setting(JOURNAL_SETTING_KEYS.contentFont, "inter")]);
    expect(prefs.contentFont).toBe("inter");
  });

  it("falls back to the theme for a face this build does not load", () => {
    // The failure path that matters: the value becomes a CSS variable
    // reference, and one naming a face no loader declares would silently
    // render the browser fallback -- which reads as a bug, not a setting.
    // A script face is rejected too: those are deliberately not offered here.
    for (const bogus of ["", "   ", "comic-sans", "great-vibes", "Inter", "font-inter"]) {
      const prefs = resolveJournalPreferences([
        setting(JOURNAL_SETTING_KEYS.contentFont, bogus),
      ]);
      expect(prefs.contentFont, `stored ${JSON.stringify(bogus)}`).toBeNull();
    }
    // And an absent row means the same thing.
    expect(resolveJournalPreferences([]).contentFont).toBeNull();
  });

  it("maps a chosen face to the CSS variable the loaders declare", () => {
    expect(contentFontFamily("inter")).toBe("var(--font-inter)");
    expect(contentFontFamily("jetbrains-mono")).toBe("var(--font-jetbrains-mono)");
  });

  it("maps no face, and an unloaded one, to undefined", () => {
    // `undefined` rather than a family name, so the caller omits the property
    // entirely and the theme's own body font keeps applying.
    expect(contentFontFamily(null)).toBeUndefined();
    expect(contentFontFamily("great-vibes" as never)).toBeUndefined();
  });

  it("omits the face row when unset, rather than writing a blank", () => {
    const entries = journalPreferencesToEntries({
      defaultLocation: null,
      temperatureUnit: "fahrenheit",
      photoRoot: "",
      handwritingSize: "xl",
      reviewBeforeCalendarImport: false,
      topicMatchBody: false,
      topicEpisodeGapDays: 14,
      excludedWords: [],
      contentTextureId: null,
      contentTextureOpacity: 0.1,
      contentTextColor: null,
      contentFont: null,
      contentFontSize: "sm",
    });
    expect(entries.some((entry) => entry.key === JOURNAL_SETTING_KEYS.contentFont)).toBe(false);
    expect(entries.every((entry) => entry.value !== "")).toBe(true);
  });

  it("reads every offered size back as itself", () => {
    for (const option of CONTENT_SIZE_OPTIONS) {
      const prefs = resolveJournalPreferences([
        setting(JOURNAL_SETTING_KEYS.contentFontSize, option.value),
      ]);
      expect(prefs.contentFontSize, `stored ${option.value}`).toBe(option.value);
    }
  });

  it("falls back to 14px for a size it does not offer", () => {
    for (const bogus of ["xs", "3xl", "14px", "", "Small"]) {
      const prefs = resolveJournalPreferences([
        setting(JOURNAL_SETTING_KEYS.contentFontSize, bogus),
      ]);
      expect(prefs.contentFontSize, `stored ${JSON.stringify(bogus)}`).toBe("sm");
    }
  });

  it("starts at the size the field already used, so nothing moves until asked", () => {
    // `sm` is 14px -- what every other field on the entry form uses, and what
    // the Content field was before this was configurable.
    expect(resolveJournalPreferences([]).contentFontSize).toBe("sm");
    expect(CONTENT_SIZE_OPTIONS[0]).toMatchObject({ value: "sm", px: 14 });
  });

  it("maps every offered size to a distinct literal Tailwind class", () => {
    // Literal, because Tailwind compiles ahead of time -- an interpolated
    // `text-[...]` would emit no CSS and the field would lose its size.
    const classes = CONTENT_SIZE_OPTIONS.map((option) => option.className);
    expect(new Set(classes).size).toBe(CONTENT_SIZE_OPTIONS.length);
    for (const option of CONTENT_SIZE_OPTIONS) {
      expect(contentSizeClass(option.value)).toBe(option.className);
    }
  });

  it("steps the fullscreen stage one size up, and saturates at the top", () => {
    expect(nextContentSizeUp("sm")).toBe("base");
    expect(nextContentSizeUp("xl")).toBe("2xl");
    // Nothing above `2xl`: wrapping would make the stage smaller than the card.
    expect(nextContentSizeUp("2xl")).toBe("2xl");
  });
});
