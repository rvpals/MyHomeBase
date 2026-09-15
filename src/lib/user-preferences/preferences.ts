import { resolveCompactNavStyle } from "./nav-style";
import type { UserPreference, UserPreferences, WeatherLocation } from "./types";

// The keys a preference is stored under. Adding a preference means a key here
// and a field on UserPreferences — not a migration (see migrations/0044).
export const USER_PREFERENCE_KEYS = {
  favoriteModuleSlug: "favorite_module_slug",
  openFavoriteModuleOnStartup: "open_favorite_module_on_startup",
  compactNavStyle: "compact_nav_style",
  weatherLatitude: "weather_latitude",
  weatherLongitude: "weather_longitude",
  weatherPlaceName: "weather_place_name",
  weatherUnit: "weather_unit",
} as const;

// Stored form of the boolean. "1"/"0" rather than "true"/"false" to match how
// the app's other stored flags read (sys_modules.is_visible, sys_users.is_disabled).
const TRUE_VALUE = "1";
const FALSE_VALUE = "0";

/**
 * The three weather rows back into one location, or `undefined`.
 *
 * All-or-nothing on purpose. A row can be blank (nothing set), and a hand-edited or
 * partially-written set of rows could leave coordinates without a name; either way the
 * card needs all three to draw itself, so anything short of a complete, numeric,
 * in-range triple reads as "no location" rather than as a half-configured one. That
 * also means a bad row degrades to the plain clock instead of throwing on the home
 * screen.
 */
function resolveWeatherLocation(byKey: Map<string, string>): WeatherLocation | undefined {
  const storedLatitude = byKey.get(USER_PREFERENCE_KEYS.weatherLatitude)?.trim() ?? "";
  const storedLongitude = byKey.get(USER_PREFERENCE_KEYS.weatherLongitude)?.trim() ?? "";
  const name = byKey.get(USER_PREFERENCE_KEYS.weatherPlaceName)?.trim() ?? "";

  // Checked before parsing, not after: `Number("")` is 0, and 0,0 is a real
  // coordinate (in the Gulf of Guinea), so an unset location would otherwise resolve
  // to a valid-looking place off the coast of Africa.
  if (storedLatitude === "" || storedLongitude === "" || name === "") return undefined;

  const latitude = Number(storedLatitude);
  const longitude = Number(storedLongitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return undefined;

  return { latitude, longitude, name };
}

/**
 * Parses a user's key/value rows into typed preferences.
 *
 * This is the single place blank becomes `undefined`: `preference_value` is
 * TEXT NOT NULL, so "no favorite" is stored as "". Callers get `undefined` and
 * never compare against the empty string. An unrecognised or missing flag value
 * reads as `false` — the conservative direction, since a garbled value should
 * leave someone on the home screen rather than redirect them somewhere they
 * didn't ask to go.
 *
 * Mirrors resolveJournalPreferences for the journal module.
 */
export function resolveUserPreferences(preferences: UserPreference[]): UserPreferences {
  const byKey = new Map(preferences.map((preference) => [preference.key, preference.value]));

  const storedSlug = byKey.get(USER_PREFERENCE_KEYS.favoriteModuleSlug)?.trim() ?? "";

  return {
    favoriteModuleSlug: storedSlug === "" ? undefined : storedSlug,
    openFavoriteModuleOnStartup:
      byKey.get(USER_PREFERENCE_KEYS.openFavoriteModuleOnStartup) === TRUE_VALUE,
    // Total by construction: a missing row and a garbled one both resolve to the
    // default, because the compact shell has to draw *some* navigation.
    compactNavStyle: resolveCompactNavStyle(byKey.get(USER_PREFERENCE_KEYS.compactNavStyle)),
    weatherLocation: resolveWeatherLocation(byKey),
    // Anything unrecognised reads as Fahrenheit, matching the weather schema's own
    // default rather than inventing a second answer.
    weatherUnit:
      byKey.get(USER_PREFERENCE_KEYS.weatherUnit)?.trim() === "celsius" ? "celsius" : "fahrenheit",
  };
}

/**
 * Serializes preferences into the entries a repository write takes.
 *
 * Unlike journalPreferencesToEntries, an unset favorite is written as "" rather
 * than omitted: these are per-key upserts, so omitting the key would leave the
 * previous favorite in place and "clear my favorite" would silently do nothing.
 */
export function userPreferencesToEntries(
  preferences: UserPreferences,
): { key: string; value: string }[] {
  return [
    {
      key: USER_PREFERENCE_KEYS.favoriteModuleSlug,
      value: preferences.favoriteModuleSlug ?? "",
    },
    {
      key: USER_PREFERENCE_KEYS.openFavoriteModuleOnStartup,
      value: preferences.openFavoriteModuleOnStartup ? TRUE_VALUE : FALSE_VALUE,
    },
    {
      key: USER_PREFERENCE_KEYS.compactNavStyle,
      value: preferences.compactNavStyle,
    },
    // Written as "" when unset, for the same reason the favorite is: these are
    // per-key upserts, so omitting the key would leave the old location in place and
    // "clear my location" would silently do nothing.
    {
      key: USER_PREFERENCE_KEYS.weatherLatitude,
      value: preferences.weatherLocation ? String(preferences.weatherLocation.latitude) : "",
    },
    {
      key: USER_PREFERENCE_KEYS.weatherLongitude,
      value: preferences.weatherLocation ? String(preferences.weatherLocation.longitude) : "",
    },
    {
      key: USER_PREFERENCE_KEYS.weatherPlaceName,
      value: preferences.weatherLocation?.name ?? "",
    },
    {
      key: USER_PREFERENCE_KEYS.weatherUnit,
      value: preferences.weatherUnit,
    },
  ];
}
