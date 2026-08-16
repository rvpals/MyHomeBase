import type { UserPreference, UserPreferences } from "./types";

// The keys a preference is stored under. Adding a preference means a key here
// and a field on UserPreferences — not a migration (see migrations/0044).
export const USER_PREFERENCE_KEYS = {
  favoriteModuleSlug: "favorite_module_slug",
  openFavoriteModuleOnStartup: "open_favorite_module_on_startup",
} as const;

// Stored form of the boolean. "1"/"0" rather than "true"/"false" to match how
// the app's other stored flags read (sys_modules.is_visible, sys_users.is_disabled).
const TRUE_VALUE = "1";
const FALSE_VALUE = "0";

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
  ];
}
