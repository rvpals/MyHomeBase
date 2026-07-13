import type { ModuleSettingEntry } from "./schema";
import type { ModuleSetting } from "./types";

export interface ModuleSettingsRepository {
  listByModuleId(moduleId: number): ModuleSetting[];
  listAll(): ModuleSetting[];
  /** Replaces every setting for this module with exactly these entries (add/edit/remove in one step). */
  replaceForModule(moduleId: number, entries: ModuleSettingEntry[]): void;
}
