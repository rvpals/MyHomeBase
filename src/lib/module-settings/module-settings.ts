import type { ModuleSettingsRepository } from "./ports";
import {
  moduleSettingsSaveSchema,
  type ModuleSettingEntry,
  type ModuleSettingsSave,
} from "./schema";
import type { ModuleSetting } from "./types";

export function listAllModuleSettings(repo: ModuleSettingsRepository): ModuleSetting[] {
  return repo.listAll();
}

export function listModuleSettingsFor(
  repo: ModuleSettingsRepository,
  moduleId: number,
): ModuleSetting[] {
  return repo.listByModuleId(moduleId);
}

export function saveModuleSettings(
  repo: ModuleSettingsRepository,
  input: ModuleSettingsSave,
): ModuleSetting[] {
  const validated = moduleSettingsSaveSchema.parse(input);
  repo.replaceForModule(validated.moduleId, validated.entries);
  return repo.listByModuleId(validated.moduleId);
}

/**
 * Saves only the given keys, leaving every other setting on the module untouched.
 *
 * `saveModuleSettings` replaces a module's settings *wholesale* -- the repository
 * deletes every row for the module and reinserts exactly what it was handed. That
 * is the right shape for the Administration -> Module Configuration editor, which
 * genuinely presents the full set and can add and remove keys in one save.
 *
 * It is the wrong shape for a screen that owns a handful of keys, and the Stocks &
 * ETFs module has three such screens (the scan thresholds, the dashboard layout,
 * and the auto-refresh switch). Each passing only its own keys through the
 * wholesale save means whichever saves last wipes the others.
 *
 * So a partial save reads the current rows, overlays the new values by key, and
 * writes the union back. Keys absent from `entries` are preserved; keys present
 * are overwritten. Removing a key still needs the wholesale save -- this function
 * cannot express a deletion, deliberately, since a caller that only knows about
 * two keys has no business deciding a third should go.
 */
export function saveModuleSettingsPartial(
  repo: ModuleSettingsRepository,
  moduleId: number,
  entries: ModuleSettingEntry[],
): ModuleSetting[] {
  const incoming = new Map(entries.map((entry) => [entry.key, entry]));

  const merged: ModuleSettingEntry[] = repo.listByModuleId(moduleId).map((existing) => {
    const replacement = incoming.get(existing.key);
    incoming.delete(existing.key);
    return {
      key: existing.key,
      // A partial save carries a value, not a description, so the stored
      // description survives an overwrite rather than being blanked.
      value: replacement ? replacement.value : existing.value,
      description: replacement?.description ?? existing.description,
    };
  });

  // Whatever is left is a key the module didn't have yet -- a first save, or one
  // added by a migration that hasn't been written to since.
  merged.push(...incoming.values());

  return saveModuleSettings(repo, { moduleId, entries: merged });
}

/**
 * Removes one setting, leaving every other key for the module untouched.
 *
 * Exists because module-setting *values* must be non-empty, so "clear this field"
 * cannot be expressed as a save -- and the repository port deliberately offers only
 * `replaceForModule`, so the filter has to happen in a use-case rather than as a
 * per-key DELETE nobody else needs. A missing key and an empty one already mean the
 * same thing to every `resolve*Settings` reader, which is what makes deleting the
 * right way to clear it.
 *
 * A key the module doesn't have is not an error: the end state is the same either way.
 */
export function removeModuleSetting(
  repo: ModuleSettingsRepository,
  moduleId: number,
  key: string,
): ModuleSetting[] {
  const remaining: ModuleSettingEntry[] = repo
    .listByModuleId(moduleId)
    .filter((setting) => setting.key !== key)
    .map((setting) => ({
      key: setting.key,
      value: setting.value,
      description: setting.description,
    }));

  return saveModuleSettings(repo, { moduleId, entries: remaining });
}
