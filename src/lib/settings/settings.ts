import { DEFAULT_APP_SETTINGS } from "./defaults";
import type { SettingsRepository } from "./ports";
import { settingUpdateListSchema, startupMessageSchema, type SettingUpdate } from "./schema";
import type { Setting } from "./types";

export const STARTUP_MESSAGE_KEY = "STARTUP_MESSAGE";

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

/**
 * The one-shot message shown when the home screen is reached, or `undefined` when
 * there is nothing to show.
 *
 * Blank is the "nothing to show" sentinel (the column is `TEXT NOT NULL`), and a
 * whitespace-only value counts as blank so a stray space from a deploy script can't
 * put an empty dialog in front of the user.
 */
export function getStartupMessage(repo: SettingsRepository): string | undefined {
  const message = repo.getSetting(STARTUP_MESSAGE_KEY)?.value.trim();
  return message ? message : undefined;
}

/** Sets the message. A blank value is allowed and means the same as clearing it. */
export function setStartupMessage(repo: SettingsRepository, message: string): void {
  repo.setValue(STARTUP_MESSAGE_KEY, startupMessageSchema.parse(message).trim());
}

/** Clears the message so it is shown once and not again. */
export function clearStartupMessage(repo: SettingsRepository): void {
  repo.setValue(STARTUP_MESSAGE_KEY, "");
}

/**
 * The wording a deployment writes. Kept here so the Windows publish, the NAS
 * `start.sh` and the CLI all produce the same sentence instead of three variants.
 */
export function formatDeploymentMessage(publishedAt: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp =
    `${publishedAt.getFullYear()}-${pad(publishedAt.getMonth() + 1)}-${pad(publishedAt.getDate())}` +
    ` ${pad(publishedAt.getHours())}:${pad(publishedAt.getMinutes())}`;
  return `A new deployment is published on ${stamp}`;
}
