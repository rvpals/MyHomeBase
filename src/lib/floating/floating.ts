import type { SettingsRepository } from "@/lib/settings";
import {
  FLOATING_ENABLED_SETTING_KEY,
  enabledFloatingToValue,
  resolveEnabledFloating,
} from "./registry";
import { enabledFloatingSchema } from "./schema";
import type { FloatingId } from "./types";

/**
 * Which floating components are available to the household.
 *
 * Takes the settings repository's port, not a database — so the CLI, the admin screen
 * and a unit test with a fake all drive the same function.
 */
export function getEnabledFloating(repo: SettingsRepository): FloatingId[] {
  return resolveEnabledFloating(repo.getSetting(FLOATING_ENABLED_SETTING_KEY)?.value);
}

/**
 * Stores the enabled list, returning what is now stored.
 *
 * **`setValue`, not `updateSettings`.** The latter is a plain `UPDATE ... WHERE key = ?`,
 * so against a database with no `floating_enabled` row it would report success and write
 * nothing — the exact trap the Dashboard Widgets action documents relying on its
 * migration-seeded row to avoid. This feature ships no migration (the setting is a
 * key/value row), so the write has to upsert. `setValue` does.
 *
 * Validated with the module's schema rather than trusting the caller: this is a
 * boundary, and an unknown id reaching the stored value would sit there until someone
 * read the row by hand.
 */
export function setEnabledFloating(
  repo: SettingsRepository,
  ids: readonly string[],
): FloatingId[] {
  const validated = enabledFloatingSchema.parse(ids);
  repo.setValue(FLOATING_ENABLED_SETTING_KEY, enabledFloatingToValue(validated));
  return getEnabledFloating(repo);
}
