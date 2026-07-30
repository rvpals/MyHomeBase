import { describe, expect, it } from "vitest";
import { JOURNAL_SETTING_KEYS, journalPreferencesToEntries, resolveJournalPreferences } from "./preferences";
import type { ModuleSetting } from "@/lib/module-settings";

function setting(key: string, value: string): ModuleSetting {
  return { id: 1, moduleId: 3, key, value };
}

describe("resolveJournalPreferences", () => {
  it("defaults to fahrenheit and no location when nothing is set", () => {
    expect(resolveJournalPreferences([])).toEqual({ defaultLocation: null, temperatureUnit: "fahrenheit" });
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
    });
    expect(entries.some((entry) => entry.key === JOURNAL_SETTING_KEYS.defaultLocationName)).toBe(false);
    expect(entries.every((entry) => entry.value !== "")).toBe(true);
  });

  it("round-trips through resolve", () => {
    const original = {
      defaultLocation: { latitude: 12.5, longitude: -70.25, name: "Somewhere" },
      temperatureUnit: "celsius" as const,
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
});
