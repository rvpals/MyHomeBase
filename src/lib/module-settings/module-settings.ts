import type { ModuleSettingsRepository } from "./ports";
import { moduleSettingsSaveSchema, type ModuleSettingsSave } from "./schema";
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
