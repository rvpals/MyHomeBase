"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import {
  removeDashboardTextureImage,
  saveDashboardTextureSettings,
  setDashboardTextureImage,
  type DashboardTextureSettings,
} from "@/lib/dashboard-texture";
import {
  saveModuleSettings,
  type ModuleSettingEntry,
} from "@/lib/module-settings";
import {
  removeModuleCarouselImage,
  resetModulesToDefaults,
  setModuleCarouselImage,
  setModuleIcon,
  updateModules,
  type Module,
  type ModuleUpdate,
} from "@/lib/modules";
import { resetSettingsToDefaults, updateSettings, type Setting } from "@/lib/settings";
import { isAdmin } from "@/lib/user";
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

/**
 * Sets a module's glyph.
 *
 * Applied on pick rather than folded into the Save button's batch, for the same
 * reason as the graphic above: the rail, the home grid and the admin card all
 * draw this one value, so a glyph chosen but not yet saved would leave the page
 * disagreeing with the chrome around it.
 *
 * Reuses `ModuleImageResult` — an ok/error pair is all either answer carries,
 * and the picker handles a failure the same way the uploader does.
 */
export async function saveModuleIconAction(
  slug: string,
  icon: string,
): Promise<ModuleImageResult> {
  try {
    setModuleIcon(deps.moduleRepo, slug, icon);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not save the icon.",
    };
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

// ---------------------------------------------------------------------------
// The home dashboard's background picture (migrations/0063).
// ---------------------------------------------------------------------------

/**
 * Rejects a caller who isn't an admin.
 *
 * The actions above predate this and lean on the `/admin` layout's redirect,
 * which is fine for the screen but not for the endpoint: a server action is
 * reachable by anyone who can post to it, layout or no layout. The texture
 * actions check for themselves. (Reading the picture is deliberately not gated —
 * every signed-in reader already sees it rendered; see the serving route.)
 */
async function requireAdmin(): Promise<void> {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser || !isAdmin(currentUser)) throw new Error("Administrators only.");
}

/** Mirrors `ModuleImageResult` — the texture screen handles both uniformly. */
export interface DashboardTextureResult {
  ok: boolean;
  error?: string;
}

/**
 * Stores an uploaded background picture.
 *
 * Takes `FormData` rather than a base64 string for the same reason
 * `saveModuleCarouselImageAction` does: a `File` streams as ordinary multipart,
 * where a base64 payload would inflate ~33% against the server-action body
 * limit. The lib boundary still receives base64, encoded here.
 */
export async function saveDashboardTextureImageAction(
  formData: FormData,
): Promise<DashboardTextureResult> {
  try {
    await requireAdmin();
    const file = formData.get("image");
    if (!(file instanceof File)) return { ok: false, error: "No image was received." };

    setDashboardTextureImage(deps.dashboardTextureRepo, {
      // Cast because the value came off a File and is unvalidated until the lib
      // schema narrows it to the allowed set.
      mimeType: file.type as never,
      base64Data: Buffer.from(await file.arrayBuffer()).toString("base64"),
    });
    // "layout" because the dashboard is a different route from this form.
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not save the image.",
    };
  }
}

/** Clears the picture, returning the dashboard to the theme's flat paper. */
export async function removeDashboardTextureImageAction(): Promise<DashboardTextureResult> {
  try {
    await requireAdmin();
    removeDashboardTextureImage(deps.dashboardTextureRepo);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not remove the image.",
    };
  }
}

/** Saves opacity / mode / blur, leaving the picture in place. */
export async function saveDashboardTextureSettingsAction(
  input: DashboardTextureSettings,
): Promise<DashboardTextureResult> {
  try {
    await requireAdmin();
    saveDashboardTextureSettings(deps.dashboardTextureRepo, input);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not save the settings.",
    };
  }
}
