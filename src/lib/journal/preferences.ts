import type { ModuleSetting } from "@/lib/module-settings";
import type { JournalPreferences, JournalTemperatureUnit } from "./types";

// Module-settings keys the journal preferences are stored under.
export const JOURNAL_SETTING_KEYS = {
  defaultLatitude: "default_latitude",
  defaultLongitude: "default_longitude",
  defaultLocationName: "default_location_name",
  temperatureUnit: "temperature_unit",
  photoRoot: "photo_root",
} as const;

const DEFAULT_TEMPERATURE_UNIT: JournalTemperatureUnit = "fahrenheit";

/**
 * Parses the journal module's key/value settings rows into typed preferences.
 * A default location is only reported when both coordinates parse as finite
 * numbers. Mirrors resolveThresholds for the Stocks module.
 */
export function resolveJournalPreferences(settings: ModuleSetting[]): JournalPreferences {
  const byKey = new Map(settings.map((setting) => [setting.key, setting.value]));

  const latitude = Number(byKey.get(JOURNAL_SETTING_KEYS.defaultLatitude));
  const longitude = Number(byKey.get(JOURNAL_SETTING_KEYS.defaultLongitude));
  const hasCoordinates =
    byKey.has(JOURNAL_SETTING_KEYS.defaultLatitude) &&
    byKey.has(JOURNAL_SETTING_KEYS.defaultLongitude) &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude);

  const defaultLocation = hasCoordinates
    ? { latitude, longitude, name: byKey.get(JOURNAL_SETTING_KEYS.defaultLocationName) ?? "" }
    : null;

  const temperatureUnit: JournalTemperatureUnit =
    byKey.get(JOURNAL_SETTING_KEYS.temperatureUnit) === "celsius" ? "celsius" : DEFAULT_TEMPERATURE_UNIT;

  // Trimmed: a stray space either side of a pasted path is invisible in the field but
  // would make the folder unreachable.
  const photoRoot = (byKey.get(JOURNAL_SETTING_KEYS.photoRoot) ?? "").trim();

  return { defaultLocation, temperatureUnit, photoRoot };
}

/**
 * Serializes preferences into module-setting entries for saveModuleSettings.
 * Entry values must be non-empty (module-settings schema), so a blank location
 * name is omitted rather than stored as "".
 */
export function journalPreferencesToEntries(
  preferences: JournalPreferences,
): { key: string; value: string }[] {
  const entries: { key: string; value: string }[] = [
    { key: JOURNAL_SETTING_KEYS.temperatureUnit, value: preferences.temperatureUnit },
  ];

  // Omitted when blank rather than stored as "": moduleSettingEntrySchema requires a
  // non-empty value, and an absent row is what "not configured" means on read.
  if (preferences.photoRoot.trim() !== "") {
    entries.push({ key: JOURNAL_SETTING_KEYS.photoRoot, value: preferences.photoRoot.trim() });
  }

  if (preferences.defaultLocation) {
    entries.push(
      { key: JOURNAL_SETTING_KEYS.defaultLatitude, value: String(preferences.defaultLocation.latitude) },
      { key: JOURNAL_SETTING_KEYS.defaultLongitude, value: String(preferences.defaultLocation.longitude) },
    );
    if (preferences.defaultLocation.name.trim() !== "") {
      entries.push({
        key: JOURNAL_SETTING_KEYS.defaultLocationName,
        value: preferences.defaultLocation.name,
      });
    }
  }

  return entries;
}
