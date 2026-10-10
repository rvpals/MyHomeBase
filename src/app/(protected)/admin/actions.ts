"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import {
  addDashboardTexture,
  deleteDashboardTexture,
  renameDashboardTexture,
  replaceDashboardTextureImage,
  saveDashboardTextureSettings,
  selectDashboardTexture,
  setDashboardTextureAppWide,
  type DashboardTextureSettings,
} from "@/lib/dashboard-texture";
import {
  addCardFrame,
  deleteCardFrame,
  renameCardFrame,
  replaceCardFrameImage,
  saveCardFrameSettings,
  selectCardFrame,
  type CardFrameSettings,
} from "@/lib/card-frame";
import {
  setModuleTextureChoice,
  type ModuleTextureChoiceInput,
} from "@/lib/module-texture";
import {
  createColorTheme,
  deleteColorTheme,
  generateColorThemes,
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
  borderWidthsToValue,
  resolveChromeStyle,
  updateSettings,
  type BorderWidths,
  type ChromeStyle,
  type ColorThemeTokens,
  type Setting,
} from "@/lib/settings";
import {
  NAV_TEXTURE_ID_KEY,
  NAV_TEXTURE_OPACITY_KEY,
  NO_NAV_TEXTURE,
  resolveNavTextureOpacity,
} from "@/lib/nav-texture";
import { isAdmin } from "@/lib/user";
import { deps } from "@/lib/wiring";

export interface SaveAdminSettingsInput {
  modules: ModuleUpdate[];
  applicationName: string;
  colorThemeId: string;
  iconSetId: string;
  chromeStyle: ChromeStyle;
  borderWidths: BorderWidths;
  moduleSettings: { moduleId: number; entries: ModuleSettingEntry[] }[];
}

export async function saveAdminSettingsAction(input: SaveAdminSettingsInput): Promise<void> {
  await requireAdmin();
  updateModules(deps.moduleRepo, input.modules);
  updateSettings(deps.settingsRepo, [
    { key: "application_name", value: input.applicationName },
    { key: "color_theme", value: input.colorThemeId },
    { key: "icon_set", value: input.iconSetId },
    // Re-resolved at the boundary rather than trusted: this is a POST endpoint,
    // so the typed field is a claim about the payload, not a guarantee. An
    // unknown id lands on the default instead of persisting a value no CSS rule
    // matches, which would leave the chrome with no treatment at all.
    { key: "chrome_style", value: resolveChromeStyle(input.chromeStyle) },
    // `borderWidthsToValue` clamps every axis to 1-4 on the way out, so a posted
    // 40 lands as 4 rather than putting a 40px rule on every card in the app.
    // Same boundary reasoning as `resolveChromeStyle` above.
    { key: "border_widths", value: borderWidthsToValue(input.borderWidths) },
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
    await requireAdmin();
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
    await requireAdmin();
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
    await requireAdmin();
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
 * An add, which additionally reports the id the library assigned.
 *
 * The gallery needs it: without the real id, a tile added this render would
 * carry a placeholder, and Tune / Replace / Delete on it would address a row
 * that doesn't exist until the router refreshes.
 */
export interface DashboardTextureAddResult extends DashboardTextureResult {
  id?: number;
}

/**
 * Reads the `image` part of a texture upload as base64 for the lib boundary.
 *
 * The picture arrives as `FormData` rather than a base64 string for the same
 * reason `saveModuleCarouselImageAction` does: a `File` streams as ordinary
 * multipart, where a base64 payload would inflate ~33% against the server-action
 * body limit. The lib boundary still receives base64, encoded here.
 */
async function readTextureUpload(formData: FormData) {
  const file = formData.get("image");
  if (!(file instanceof File)) return undefined;

  return {
    // Cast because the value came off a File and is unvalidated until the lib
    // schema narrows it to the allowed set.
    mimeType: file.type as never,
    base64Data: Buffer.from(await file.arrayBuffer()).toString("base64"),
  };
}

/**
 * Adds an uploaded picture to the texture library.
 *
 * Does **not** select it: uploading a picture shouldn't silently change what the
 * dashboard draws. The admin picks it from the gallery afterwards.
 */
export async function addDashboardTextureAction(
  formData: FormData,
): Promise<DashboardTextureAddResult> {
  try {
    await requireAdmin();
    const upload = await readTextureUpload(formData);
    if (!upload) return { ok: false, error: "No image was received." };

    const id = addDashboardTexture(
      deps.dashboardTextureRepo,
      String(formData.get("name") ?? ""),
      upload,
    );
    // "layout" because the dashboard is a different route from this form.
    revalidatePath("/", "layout");
    return { ok: true, id };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not save the image.",
    };
  }
}

/** Swaps one texture's picture, keeping its name, its knobs and its place. */
export async function replaceDashboardTextureImageAction(
  id: number,
  formData: FormData,
): Promise<DashboardTextureResult> {
  try {
    await requireAdmin();
    const upload = await readTextureUpload(formData);
    if (!upload) return { ok: false, error: "No image was received." };

    replaceDashboardTextureImage(deps.dashboardTextureRepo, id, upload);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not replace the image.",
    };
  }
}

/** Renames a texture, leaving the picture alone. */
export async function renameDashboardTextureAction(
  id: number,
  name: string,
): Promise<DashboardTextureResult> {
  try {
    await requireAdmin();
    renameDashboardTexture(deps.dashboardTextureRepo, id, name);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not rename the texture.",
    };
  }
}

/**
 * Removes a texture from the library.
 *
 * If it was the selected one the dashboard falls back to flat paper — the lib
 * clears the pointer rather than promoting a neighbour.
 */
export async function deleteDashboardTextureAction(
  id: number,
): Promise<DashboardTextureResult> {
  try {
    await requireAdmin();
    deleteDashboardTexture(deps.dashboardTextureRepo, id);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not remove the texture.",
    };
  }
}

/** Points the dashboard at a library texture, or at none with `undefined`. */
export async function selectDashboardTextureAction(
  id: number | undefined,
): Promise<DashboardTextureResult> {
  try {
    await requireAdmin();
    selectDashboardTexture(deps.dashboardTextureRepo, id);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not select the texture.",
    };
  }
}

/**
 * Sets whether the selected texture covers every screen or the home dashboard
 * alone (migration 0116).
 *
 * `revalidatePath("/", "layout")` matters more here than for its neighbours: the
 * layer this flag controls is emitted by the protected layout, so every cached
 * page in the app is stale the moment it changes.
 */
export async function setDashboardTextureAppWideAction(
  appWide: boolean,
): Promise<DashboardTextureResult> {
  try {
    await requireAdmin();
    setDashboardTextureAppWide(deps.dashboardTextureRepo, appWide);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not change where the texture shows.",
    };
  }
}

/**
 * Sets which background a module draws — inherit, a library picture, its own
 * upload, or nothing (migration 0117).
 *
 * `requireAdmin()` rather than `requireModuleAccess(slug)`: this is
 * Administration -> Module Configuration, where an admin configures every
 * module including ones they would not otherwise have access to. The slug is
 * data here, not the caller's own module.
 */
export async function setModuleTextureChoiceAction(
  slug: string,
  input: ModuleTextureChoiceInput,
): Promise<DashboardTextureResult> {
  try {
    await requireAdmin();
    setModuleTextureChoice(deps.moduleTextureRepo, slug, input);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not change the background.",
    };
  }
}

/** Saves one texture's opacity / mode / blur, leaving its picture in place. */
export async function saveDashboardTextureSettingsAction(
  id: number,
  input: DashboardTextureSettings,
): Promise<DashboardTextureResult> {
  try {
    await requireAdmin();
    saveDashboardTextureSettings(deps.dashboardTextureRepo, id, input);
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

/** How many themes one click of "Generate themes" writes. */
const GENERATED_THEME_COUNT = 5;

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

/**
 * Generates five themes and saves them immediately.
 *
 * No preview step, deliberately: this is the "surprise me" path next to the builder, and
 * a preview would make it a slower way to do what the builder already does well. An admin
 * who dislikes one deletes it — which built-ins are now deletable too, so the delete path
 * is the same for every theme on the screen.
 *
 * `count` is fixed here rather than taken from the client: it decides how many rows a
 * single click writes, so it is not the caller's to choose.
 */
export async function generateColorThemesAction(): Promise<ColorThemeResult & { count?: number }> {
  try {
    await requireAdmin();
    // `Date.now()` is the seed, so two clicks give different themes. The use-case takes
    // it as a parameter precisely so the tests can pin it.
    const created = generateColorThemes(deps.colorThemeRepo, GENERATED_THEME_COUNT, Date.now());
    revalidatePath("/", "layout");
    if (created.length === 0) {
      return { ok: false, error: "Could not generate any new themes — try again." };
    }
    return { ok: true, id: created[0].id, count: created.length };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not generate themes.",
    };
  }
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

// ---------------------------------------------------------------------------
// Card frames (migrations/0133)
//
// The nine-slice picture drawn as every `CustomizableCard`'s border and
// background. One selection applies application-wide, so each of these ends
// with `revalidatePath("/", "layout")` -- the frame variables are emitted by
// the protected layout, and any cached page is stale the moment they change.
// ---------------------------------------------------------------------------

export interface CardFrameResult {
  ok: boolean;
  error?: string;
}

export interface CardFrameAddResult extends CardFrameResult {
  id?: number;
}

/**
 * Adds an uploaded picture to the frame library.
 *
 * Does **not** select it: uploading a frame shouldn't silently restyle every
 * card in the application. The admin picks it from the gallery afterwards,
 * having set its slices first.
 *
 * The slices arrive in the same `FormData` as the picture rather than in a
 * later call, because a frame with no slices draws nothing -- an upload that
 * left them unset would land in the gallery as an invisible tile.
 */
export async function addCardFrameAction(formData: FormData): Promise<CardFrameAddResult> {
  try {
    await requireAdmin();
    const upload = await readTextureUpload(formData);
    if (!upload) return { ok: false, error: "No image was received." };

    const id = addCardFrame(
      deps.cardFrameRepo,
      String(formData.get("name") ?? ""),
      upload,
      readFrameSettings(formData),
    );
    revalidatePath("/", "layout");
    return { ok: true, id };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not save the frame.",
    };
  }
}

/**
 * Reads the slice/opacity knobs out of an upload's form.
 *
 * Numbers arrive as strings from `FormData`, so each is coerced here and
 * validated by the lib's zod schema -- which is what turns `"abc"` into a
 * sentence the admin screen can show rather than a `NaN` reaching SQLite.
 */
function readFrameSettings(formData: FormData): CardFrameSettings {
  const num = (key: string, fallback: number) => {
    const raw = formData.get(key);
    if (raw === null) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : NaN;
  };
  return {
    insets: {
      top: num("sliceTop", 0),
      right: num("sliceRight", 0),
      bottom: num("sliceBottom", 0),
      left: num("sliceLeft", 0),
    },
    fillOpacity: num("fillOpacity", 1),
    fill: String(formData.get("fill") ?? "stretch") as CardFrameSettings["fill"],
    centerFill: formData.get("centerFill") !== "0",
  };
}

/** Swaps one frame's picture, keeping its name, its slices and its place. */
export async function replaceCardFrameImageAction(
  id: number,
  formData: FormData,
): Promise<CardFrameResult> {
  try {
    await requireAdmin();
    const upload = await readTextureUpload(formData);
    if (!upload) return { ok: false, error: "No image was received." };

    replaceCardFrameImage(deps.cardFrameRepo, id, upload);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not replace the image.",
    };
  }
}

export async function renameCardFrameAction(id: number, name: string): Promise<CardFrameResult> {
  try {
    await requireAdmin();
    renameCardFrame(deps.cardFrameRepo, id, name);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not rename the frame.",
    };
  }
}

/**
 * Removes a frame. If it was the selected one, the repository clears the
 * selection in the same transaction and every card returns to its theme border.
 */
export async function deleteCardFrameAction(id: number): Promise<CardFrameResult> {
  try {
    await requireAdmin();
    deleteCardFrame(deps.cardFrameRepo, id);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not delete the frame.",
    };
  }
}

/**
 * Points every `CustomizableCard` at a frame, or at none.
 *
 * `undefined` is how frames are turned off, and is not an error.
 */
export async function selectCardFrameAction(id: number | undefined): Promise<CardFrameResult> {
  try {
    await requireAdmin();
    selectCardFrame(deps.cardFrameRepo, id);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not select the frame.",
    };
  }
}

/** Updates one frame's slices and knobs, leaving its picture alone. */
export async function saveCardFrameSettingsAction(
  id: number,
  settings: CardFrameSettings,
): Promise<CardFrameResult> {
  try {
    await requireAdmin();
    saveCardFrameSettings(deps.cardFrameRepo, id, settings);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not save the frame settings.",
    };
  }
}


/**
 * Saves the navigation's background texture -- which library picture the
 * navigation draws behind its rows, and how strongly.
 *
 * One app-wide choice covering both navigation surfaces: the desktop tree and
 * the compact bottom bar. There is no per-surface variant on purpose -- a reader
 * sees one of the two at a time, so a second setting would be a control whose
 * effect nobody can observe.
 *
 * Writes through `updateSettings` like every other app setting, which is also why
 * "no picture" is stored as `NO_NAV_TEXTURE` rather than a blank: that schema
 * requires a non-empty value. The opacity is clamped by the same function the
 * resolver uses, so the stored value and the drawn one cannot disagree -- the
 * settings table has no CHECK to fall back on.
 */
export async function saveNavTextureAction(input: {
  textureId?: number;
  opacity: number;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin();
    updateSettings(deps.settingsRepo, [
      {
        key: NAV_TEXTURE_ID_KEY,
        value: input.textureId === undefined ? NO_NAV_TEXTURE : String(input.textureId),
      },
      {
        key: NAV_TEXTURE_OPACITY_KEY,
        value: String(resolveNavTextureOpacity(String(input.opacity))),
      },
    ]);
    // `"layout"`, not the texture page: the navigation renders on every screen
    // from every shell, so a narrower revalidate would leave the tree showing the
    // old picture everywhere except the screen that changed it.
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not save the toolbar texture.",
    };
  }
}
