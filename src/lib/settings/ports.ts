import type { SettingUpdate } from "./schema";
import type { Setting } from "./types";

// The use-cases depend on THIS interface, not on a concrete database.
export interface SettingsRepository {
  listSettings(): Setting[];
  getSetting(key: string): Setting | undefined;
  updateAll(updates: SettingUpdate[]): void;
  // Single-key write that accepts a blank value. `updateAll` can't: its schema
  // requires a non-empty string so the admin screen can't blank a setting.
  setValue(key: string, value: string): void;
  resetToDefaults(defaults: Setting[]): void;
}
