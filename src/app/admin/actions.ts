"use server";

import { revalidatePath } from "next/cache";
import {
  resetModulesToDefaults,
  updateModules,
  type Module,
  type ModuleUpdate,
} from "@/lib/modules";
import { resetSettingsToDefaults, updateSettings, type Setting } from "@/lib/settings";
import { deps } from "@/lib/wiring";

export interface SaveAdminSettingsInput {
  modules: ModuleUpdate[];
  applicationName: string;
  colorThemeId: string;
}

export async function saveAdminSettingsAction(input: SaveAdminSettingsInput): Promise<void> {
  updateModules(deps.moduleRepo, input.modules);
  updateSettings(deps.settingsRepo, [
    { key: "application_name", value: input.applicationName },
    { key: "color_theme", value: input.colorThemeId },
  ]);

  revalidatePath("/", "layout");
}

export interface ResetAdminSettingsResult {
  modules: Module[];
  settings: Setting[];
}

export async function resetAdminSettingsAction(): Promise<ResetAdminSettingsResult> {
  const modules = resetModulesToDefaults(deps.moduleRepo);
  const settings = resetSettingsToDefaults(deps.settingsRepo);

  revalidatePath("/", "layout");

  return { modules, settings };
}
