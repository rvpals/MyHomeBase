import { DEFAULT_APP_SETTINGS } from "./defaults";
import type { SettingsRepository } from "./ports";
import { settingUpdateListSchema, type SettingUpdate } from "./schema";
import type { Setting } from "./types";

export function listSettings(repo: SettingsRepository): Setting[] {
  return repo.listSettings();
}

export function getSetting(repo: SettingsRepository, key: string): Setting | undefined {
  return repo.getSetting(key);
}

export function updateSettings(repo: SettingsRepository, updates: SettingUpdate[]): Setting[] {
  const validated = settingUpdateListSchema.parse(updates);
  repo.updateAll(validated);
  return repo.listSettings();
}

export function resetSettingsToDefaults(repo: SettingsRepository): Setting[] {
  repo.resetToDefaults(DEFAULT_APP_SETTINGS);
  return repo.listSettings();
}
