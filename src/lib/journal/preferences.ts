import type { ModuleSetting } from "@/lib/module-settings";
import type {
  JournalHandwritingSize,
  JournalPreferences,
  JournalTemperatureUnit,
} from "./types";

// Module-settings keys the journal preferences are stored under.
export const JOURNAL_SETTING_KEYS = {
  defaultLatitude: "default_latitude",
  defaultLongitude: "default_longitude",
  defaultLocationName: "default_location_name",
  temperatureUnit: "temperature_unit",
  photoRoot: "photo_root",
  handwritingSize: "handwriting_size",
  reviewBeforeCalendarImport: "review_before_calendar_import",
} as const;

const DEFAULT_TEMPERATURE_UNIT: JournalTemperatureUnit = "fahrenheit";

/** 20px — the `font-script` floor, and what the field used before it was configurable. */
const DEFAULT_HANDWRITING_SIZE: JournalHandwritingSize = "xl";

/**
 * The offered handwriting sizes, in order: what to store, what to call it, and the
 * Tailwind class that draws it.
 *
 * One table so the Preferences dropdown and the Content field read the same list —
 * a second copy is how a select ends up offering a size nothing renders. `label`
 * is named rather than numeric because this is a reading-comfort choice, not a
 * typographic one.
 *
 * Every `className` here is a literal that appears in the source, so Tailwind's
 * scanner emits all four. Don't rewrite these as interpolations.
 */
export const HANDWRITING_SIZE_OPTIONS: readonly {
  value: JournalHandwritingSize;
  label: string;
  className: string;
  px: number;
}[] = [
  { value: "xl", label: "Small", className: "text-xl", px: 20 },
  { value: "2xl", label: "Medium", className: "text-2xl", px: 24 },
  { value: "3xl", label: "Large", className: "text-3xl", px: 30 },
  { value: "4xl", label: "X-Large", className: "text-4xl", px: 36 },
];

/**
 * The Tailwind class for a stored size, falling back to the default for anything
 * unrecognised — so a hand-edited settings row can't leave the field with no size
 * class at all.
 */
export function handwritingSizeClass(size: JournalHandwritingSize): string {
  const match = HANDWRITING_SIZE_OPTIONS.find((option) => option.value === size);
  return (match ?? HANDWRITING_SIZE_OPTIONS[0]).className;
}

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

  // Clamped against the offered list rather than cast, for the same reason the unit
  // above is: the stored value becomes a CSS class, and an unrecognised one (a hand-
  // edited row, a value from an older build) would render the field with no size at
  // all. Falling back keeps the 20px `font-script` floor a property of the read path.
  const storedSize = byKey.get(JOURNAL_SETTING_KEYS.handwritingSize);
  const handwritingSize =
    HANDWRITING_SIZE_OPTIONS.find((option) => option.value === storedSize)?.value ??
    DEFAULT_HANDWRITING_SIZE;

  // Only the exact string "true" reads as on. A boolean stored as text has no
  // shortage of ways to arrive wrong ("1", "yes", ""), and treating anything
  // non-empty as true would turn a hand-edited "false" row into a yes.
  const reviewBeforeCalendarImport =
    byKey.get(JOURNAL_SETTING_KEYS.reviewBeforeCalendarImport) === "true";

  return {
    defaultLocation,
    temperatureUnit,
    photoRoot,
    handwritingSize,
    reviewBeforeCalendarImport,
  };
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
    // Always written, including at the default: the value is a closed set with no
    // "unset" member, so a row is never ambiguous the way a blank path would be.
    { key: JOURNAL_SETTING_KEYS.handwritingSize, value: preferences.handwritingSize },
    // Written at both values, including the `false` default: a missing row and a
    // stored "false" must mean the same thing, and only writing the true case
    // would make unticking the box a no-op.
    {
      key: JOURNAL_SETTING_KEYS.reviewBeforeCalendarImport,
      value: preferences.reviewBeforeCalendarImport ? "true" : "false",
    },
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
