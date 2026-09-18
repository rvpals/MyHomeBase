import { describe, expect, it } from "vitest";
import {
  HANDWRITING_SIZE_OPTIONS,
  JOURNAL_SETTING_KEYS,
  handwritingSizeClass,
  journalPreferencesToEntries,
  resolveJournalPreferences,
} from "./preferences";
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
    });
  });

  it("ignores a partial/invalid location", () => {
    const prefs = resolveJournalPreferences([setting(JOURNAL_SETTING_KEYS.defaultLatitude, "40.34")]);
    expect(prefs.defaultLocation).toBeNull();
  });
});

describe("journalPreferencesToEntries", () => {
  it("omits a blank location name (module-setting values must be non-empty)", () => {
    const entries = journalPreferencesToEntries({
      defaultLocation: { latitude: 1, longitude: 2, name: "" },
      temperatureUnit: "fahrenheit",
      photoRoot: "",
      handwritingSize: "xl",
      reviewBeforeCalendarImport: false,
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
    });
    expect(entries.find((entry) => entry.key === JOURNAL_SETTING_KEYS.handwritingSize)?.value).toBe(
      "2xl",
    );
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
      });
      expect(
        entries.find((entry) => entry.key === JOURNAL_SETTING_KEYS.reviewBeforeCalendarImport)
          ?.value,
        `enabled ${enabled}`,
      ).toBe(enabled ? "true" : "false");
    }
  });
});
