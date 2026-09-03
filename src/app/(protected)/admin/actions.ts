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
  createColorTheme,
  deleteColorTheme,
  duplicateColorTheme,
  resetBuiltinTheme,
  saveColorTheme,
} from "@/lib/color-themes";
import { clearOverride, saveOverride, ICON_OVERRIDE_MAX_BYTES } from "@/lib/icons";
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
import {
  DEFAULT_COLOR_THEME_ID,
  getSetting,
  resetSettingsToDefaults,
  updateSettings,
  type ColorThemeTokens,
  type Setting,
} from "@/lib/settings";
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

    await setModuleCarouselImage(
      deps.moduleRepo,
      slug,
      {
        // Cast because the value came off a File and is unvalidated until the lib
        // schema narrows it to the allowed set.
        mimeType: file.type as never,
        base64Data: Buffer.from(await file.arrayBuffer()).toString("base64"),
      },
      // Downscales to 800px WebP before it reaches the column. Without this a
      // 2 MB original is stored whole and then downloaded whole to fill a 192px
      // tile, which is what made the carousel paint in slowly.
      deps.carouselImageProcessor,
    );
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


/** Mirrors the texture/carousel results — the icons screen handles them the same way. */
export interface IconOverrideResult {
  ok: boolean;
  error?: string;
}

/**
 * Stores an uploaded glyph for one icon slot, under one icon set.
 *
 * `FormData` rather than a base64 argument, for the reason the carousel and texture
 * actions give: a `File` streams as ordinary multipart where base64 inflates ~33%
 * against the server-action body limit.
 *
 * The SVG branch reads the file as *text* and hands the markup to the lib, which
 * sanitizes it before storage — see src/lib/icons/sanitize-svg.ts. Raster goes through
 * the shared image decoder untouched.
 */
export async function saveIconOverrideAction(formData: FormData): Promise<IconOverrideResult> {
  try {
    await requireAdmin();

    const slotId = String(formData.get("slotId") ?? "");
    const setId = String(formData.get("setId") ?? "");
    const file = formData.get("icon");
    if (!(file instanceof File)) return { ok: false, error: "No file was received." };
    if (file.size > ICON_OVERRIDE_MAX_BYTES) {
      return {
        ok: false,
        error: `That file is ${Math.round(file.size / 1024)} KB — keep it under ${Math.round(
          ICON_OVERRIDE_MAX_BYTES / 1024,
        )} KB.`,
      };
    }

    // An SVG is markup, so it is read as text and sanitized; everything else is bytes.
    // Some browsers report an empty type for .svg, hence the filename check.
    const isSvg = file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");

    if (isSvg) {
      await saveOverride(deps.iconOverridesRepo, {
        slotId,
        setId,
        kind: "svg",
        source: await file.text(),
      });
    } else {
      await saveOverride(
        deps.iconOverridesRepo,
        {
          slotId,
          setId,
          kind: "raster",
          // Cast because the value came off a File and is unvalidated until the lib
          // schema narrows it to the allowed set.
          mimeType: file.type as never,
          base64Data: Buffer.from(await file.arrayBuffer()).toString("base64"),
        },
        new Date(),
        // Strips a flattened checkerboard, trims dead margin and downscales to 256px PNG.
        // Passed only on this branch: an SVG needs none of it.
        deps.iconImageProcessor,
      );
    }

    // "layout" because the overridden icon renders outside this form — the root layout
    // reads the override map.
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not save that icon.",
    };
  }
}

/** Removes an override so the slot falls back to the active set's own glyph. */
export async function clearIconOverrideAction(
  slotId: string,
  setId: string,
): Promise<IconOverrideResult> {
  try {
    await requireAdmin();
    clearOverride(deps.iconOverridesRepo, { slotId, setId });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not remove that icon.",
    };
  }
}


/* ---------------------------------------------------------------------------
   Color themes (migrations/0076).

   Themes are data now, so the Color Themes screen does more than pick one: it
   creates, edits, duplicates, resets and deletes them. Each action below is its own
   endpoint rather than folded into `saveAdminSettingsAction`'s batch, because the
   builder saves one theme at a time and needs a per-theme error to show.

   All five revalidate "layout": a theme change repaints the entire app, not this form.
   ------------------------------------------------------------------------ */

/** Mirrors the other result envelopes on this screen. */
export interface ColorThemeResult {
  ok: boolean;
  error?: string;
  /** The id that was written, so the view can select a newly created theme. */
  id?: string;
}

/** What the builder posts. Validated by the lib schema, not here. */
export interface ColorThemeFormInput {
  id: string;
  name: string;
  description: string;
  tokens: ColorThemeTokens;
}

export async function createColorThemeAction(
  input: ColorThemeFormInput,
): Promise<ColorThemeResult> {
  try {
    await requireAdmin();
    const created = createColorTheme(deps.colorThemeRepo, { ...input, sortOrder: 100 });
    revalidatePath("/", "layout");
    return { ok: true, id: created.id };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not create that theme.",
    };
  }
}

/**
 * Overwrites a theme, built-in or not.
 *
 * `sortOrder` is read from the existing row rather than taken from the form — the
 * builder does not offer it, and defaulting it to 100 here would silently move every
 * built-in to the end of the picker on its first edit.
 */
export async function saveColorThemeAction(
  input: ColorThemeFormInput,
): Promise<ColorThemeResult> {
  try {
    await requireAdmin();
    const existing = deps.colorThemeRepo.get(input.id);
    saveColorTheme(deps.colorThemeRepo, {
      ...input,
      sortOrder: existing?.sortOrder ?? 100,
    });
    revalidatePath("/", "layout");
    return { ok: true, id: input.id };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not save that theme.",
    };
  }
}

export async function duplicateColorThemeAction(
  sourceId: string,
  newName: string,
): Promise<ColorThemeResult> {
  try {
    await requireAdmin();
    const copy = duplicateColorTheme(deps.colorThemeRepo, sourceId, newName);
    revalidatePath("/", "layout");
    return { ok: true, id: copy.id };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not duplicate that theme.",
    };
  }
}

/**
 * Deletes a user theme.
 *
 * The active theme id is read HERE and passed in, rather than read inside the use-case:
 * the use-case stays a function of its arguments, and the setting is a presentation-layer
 * concern the action already has `deps` for.
 */
export async function deleteColorThemeAction(id: string): Promise<ColorThemeResult> {
  try {
    await requireAdmin();
    const activeId =
      getSetting(deps.settingsRepo, "color_theme")?.value ?? DEFAULT_COLOR_THEME_ID;
    deleteColorTheme(deps.colorThemeRepo, { id }, activeId);
    revalidatePath("/", "layout");
    return { ok: true, id };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not delete that theme.",
    };
  }
}

/** Copies a built-in back to its definition in `COLOR_THEMES`. */
export async function resetColorThemeAction(id: string): Promise<ColorThemeResult> {
  try {
    await requireAdmin();
    resetBuiltinTheme(deps.colorThemeRepo, id);
    revalidatePath("/", "layout");
    return { ok: true, id };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not reset that theme.",
    };
  }
}
