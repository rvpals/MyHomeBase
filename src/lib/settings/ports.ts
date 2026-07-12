import type { SettingUpdate } from "./schema";
import type { Setting } from "./types";

// The use-cases depend on THIS interface, not on a concrete database.
export interface SettingsRepository {
  listSettings(): Setting[];
  getSetting(key: string): Setting | undefined;
  updateAll(updates: SettingUpdate[]): void;
  resetToDefaults(defaults: Setting[]): void;
}
