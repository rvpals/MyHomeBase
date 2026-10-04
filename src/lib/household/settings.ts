// The Household module's settings — `sys_module_settings` key/value rows, the same
// storage the Journal's `photo_root` uses, so adding one needs no migration.

import { z } from "zod";
import {
  listModuleSettingsFor,
  removeModuleSetting,
  saveModuleSettingsPartial,
  type ModuleSettingsRepository,
} from "@/lib/module-settings";
import { getModuleBySlug, type ModuleRepository } from "@/lib/modules";
import type { ReceiptFileStore, ReceiptRootCheck } from "./receipt-store";

export const HOUSEHOLD_MODULE_SLUG = "household";

export const HOUSEHOLD_SETTING_KEYS = {
  /** The folder HSA receipts are filed under, by year. */
  hsaReceiptRoot: "hsa_receipt_root",
} as const;

export interface HouseholdSettings {
  /** `""` = not set, and attaching a receipt is refused until it is. */
  hsaReceiptRoot: string;
}

/** Reads the settings out of the module's rows, defaulting anything absent. */
export function resolveHouseholdSettings(rows: { key: string; value: string }[]): HouseholdSettings {
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  return { hsaReceiptRoot: (byKey.get(HOUSEHOLD_SETTING_KEYS.hsaReceiptRoot) ?? "").trim() };
}

/** The Household module's settings, looked up by slug. Defaults if the module is missing. */
export function getHouseholdSettings(
  moduleRepo: ModuleRepository,
  settingsRepo: ModuleSettingsRepository,
): HouseholdSettings {
  const appModule = getModuleBySlug(moduleRepo, HOUSEHOLD_MODULE_SLUG);
  if (!appModule) return resolveHouseholdSettings([]);
  return resolveHouseholdSettings(listModuleSettingsFor(settingsRepo, appModule.id));
}

export const hsaReceiptRootSchema = z.string().trim().max(500, "That path is too long.");

/** What a failed check means, in words the Configuration screen can show. */
export function describeReceiptRootCheck(check: ReceiptRootCheck): string {
  switch (check.kind) {
    case "ok":
      return `The server can write to ${check.path}.`;
    case "not-configured":
      return "No receipt folder is set.";
    case "missing":
      return `There is no folder at ${check.path}.`;
    case "not-a-directory":
      return `${check.path} is a file, not a folder.`;
    case "not-writable":
      return `The server cannot write to ${check.path} (${check.reason}). On a Synology, check the shared folder's permissions for the account the app runs as.`;
  }
}

/**
 * Sets (or, with `""`, clears) the receipt folder.
 *
 * A non-empty path is checked by writing a probe file before it is saved — a folder
 * the server can't write to would otherwise only be discovered on the first receipt.
 * Existing receipts are NOT moved: they're stored relative to the folder, so pointing
 * the setting at a copy of the old folder keeps them working, and pointing it at an
 * empty one leaves them unlinked until the files are copied over.
 */
export async function setHsaReceiptRoot(
  moduleRepo: ModuleRepository,
  settingsRepo: ModuleSettingsRepository,
  store: ReceiptFileStore,
  rawPath: string,
): Promise<HouseholdSettings> {
  const value = hsaReceiptRootSchema.parse(rawPath);
  const appModule = getModuleBySlug(moduleRepo, HOUSEHOLD_MODULE_SLUG);
  if (!appModule) throw new Error("The Household module is not registered.");

  if (value === "") {
    removeModuleSetting(settingsRepo, appModule.id, HOUSEHOLD_SETTING_KEYS.hsaReceiptRoot);
  } else {
    const check = await store.checkRoot(value);
    if (check.kind !== "ok") throw new Error(describeReceiptRootCheck(check));
    saveModuleSettingsPartial(settingsRepo, appModule.id, [
      {
        key: HOUSEHOLD_SETTING_KEYS.hsaReceiptRoot,
        value,
        description: "Folder HSA receipts are filed under, by year.",
      },
    ]);
  }
  return getHouseholdSettings(moduleRepo, settingsRepo);
}
