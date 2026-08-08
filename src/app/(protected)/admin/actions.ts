"use server";

import { revalidatePath } from "next/cache";
import {
  saveModuleSettings,
  type ModuleSettingEntry,
} from "@/lib/module-settings";
import {
  removeModuleCarouselImage,
  resetModulesToDefaults,
  setModuleCarouselImage,
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
  iconSetId: string;
  moduleSettings: { moduleId: number; entries: ModuleSettingEntry[] }[];
}

export async function saveAdminSettingsAction(input: SaveAdminSettingsInput): Promise<void> {
  updateModules(deps.moduleRepo, input.modules);
  updateSettings(deps.settingsRepo, [
    { key: "application_name", value: input.applicationName },
    { key: "color_theme", value: input.colorThemeId },
    { key: "icon_set", value: input.iconSetId },
  ]);
  for (const moduleSetting of input.moduleSettings) {
    saveModuleSettings(deps.moduleSettingsRepo, moduleSetting);
  }

  revalidatePath("/", "layout");
}

/** Every image action answers the same way, so the caller handles them uniformly. */
export interface ModuleImageResult {
  ok: boolean;
  error?: string;
}

/**
 * Saves a module's carousel graphic.
 *
 * Applied immediately rather than folded into the Save button's batch: the file
 * is already chosen, and holding megabytes of it in the admin form's state until
 * Save would be a lot of memory for no benefit.
 *
 * **Takes `FormData`, not a base64 string.** The other image uploads in this app
 * pass base64 as a plain action argument, which works for a 128 KB icon and
 * falls apart here: Next serialises long string arguments into nested arrays and
 * rejects anything sizeable with "Maximum array nesting exceeded", on top of the
 * ~33% inflation base64 costs against the body limit. A `File` in `FormData`
 * streams as ordinary multipart with neither problem. The lib boundary is
 * unchanged — it still receives base64, encoded here.
 */
export async function saveModuleCarouselImageAction(
  formData: FormData,
): Promise<ModuleImageResult> {
  try {
    const slug = String(formData.get("slug") ?? "");
    const file = formData.get("image");
    if (!(file instanceof File)) return { ok: false, error: "No image was received." };

    setModuleCarouselImage(deps.moduleRepo, slug, {
      // Cast because the value came off a File and is unvalidated until the lib
      // schema narrows it to the allowed set.
      mimeType: file.type as never,
      base64Data: Buffer.from(await file.arrayBuffer()).toString("base64"),
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save the image." };
  }
}

export async function removeModuleCarouselImageAction(slug: string): Promise<ModuleImageResult> {
  try {
    removeModuleCarouselImage(deps.moduleRepo, slug);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not remove the image.",
    };
  }
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
