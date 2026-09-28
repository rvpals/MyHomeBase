// The home dashboard's background picture: manage a library of up to 20, pick
// one to draw, and turn the selected one's knobs into the CSS the page emits.
//
// Pure functions over a repository port — no react, no next, no DOM.

import {
  decodeImageUpload,
  type DecodedImage,
  type ImageUploadInput,
} from "@/lib/shared/image-upload";
import type { DashboardTextureRepository } from "./ports";
import { dashboardTextureNameSchema, dashboardTextureSettingsSchema } from "./schema";
import type {
  DashboardTexture,
  DashboardTextureItem,
  DashboardTextureSettings,
} from "./types";

/**
 * The size cap for one dashboard background.
 *
 * Larger than a 20px category icon's allowance because this one legitimately
 * covers a desktop viewport — but still a cap: the bytes travel through a server
 * action, and an uncapped upload is how a 12 MP phone photo becomes a failed
 * request with no useful error. 4 MB is comfortably enough for a 2560px-wide
 * JPEG or WebP at sensible quality.
 */
export const MAX_DASHBOARD_TEXTURE_BYTES = 4 * 1024 * 1024;

/**
 * How many pictures the library holds.
 *
 * A cap rather than an open collection because these are BLOBs in the
 * application database, not files: 20 × 4 MB is already 80 MB of backup weight
 * for page decoration. Enforced here rather than as a table CHECK — SQLite can't
 * express a row-count limit in one, and an admin who hits it should see a
 * sentence naming the limit rather than a constraint error. See migration 0113.
 */
export const MAX_DASHBOARD_TEXTURES = 20;

/**
 * What the dashboard draws — the selected picture's settings.
 *
 * Cheap: carries `hasImage`, never the bytes. Returns the "no texture" state
 * when nothing is selected, so the caller needs no branch for an empty library.
 */
export function getDashboardTexture(repo: DashboardTextureRepository): DashboardTexture {
  return repo.getTexture();
}

/** Every picture in the library, in gallery order. Never carries the bytes. */
export function listDashboardTextures(
  repo: DashboardTextureRepository,
): DashboardTextureItem[] {
  return repo.listTextures();
}

/**
 * One picture's bytes, for the serving route only — the selected one when no id
 * is given.
 *
 * Everything else reads `hasImage`, which costs nothing. See
 * `migrations/0113_create_dashboard_texture_library.md`.
 */
export function getDashboardTextureImage(
  repo: DashboardTextureRepository,
  id?: number,
): DecodedImage | undefined {
  return repo.getTextureImage(id);
}

/**
 * One library picture by id, without its bytes.
 *
 * For a module drawing a library texture (0117): the pointer resolves to this
 * row's opacity, mode, blur and `updatedAt`. Returns `undefined` for a picture
 * that has since been deleted, which callers treat as "inherit" rather than an
 * error.
 */
export function getDashboardTextureById(
  repo: DashboardTextureRepository,
  id: number,
): DashboardTextureItem | undefined {
  return repo.getTextureById(id);
}

/**
 * Adds a picture to the library and returns its id.
 *
 * Throws when the library is full, when the name is empty, or when the file is
 * a disallowed type or oversized. The cap is checked *before* the image is
 * decoded: there is no point spending the work on bytes that cannot be stored.
 */
export function addDashboardTexture(
  repo: DashboardTextureRepository,
  name: string,
  input: ImageUploadInput,
): number {
  if (repo.listTextures().length >= MAX_DASHBOARD_TEXTURES) {
    throw new Error(
      `The texture library holds ${MAX_DASHBOARD_TEXTURES} pictures. Remove one before adding another.`,
    );
  }

  const cleanName = dashboardTextureNameSchema.parse(name);
  return repo.addTexture(cleanName, decodeImageUpload(input, MAX_DASHBOARD_TEXTURE_BYTES));
}

/**
 * Swaps one picture's bytes, keeping its name, its knobs and its place.
 *
 * Deliberately not "delete then add": that would lose the tuning, move the
 * texture to the end of the gallery, and — if it was the selected one — blank
 * the dashboard in between.
 */
export function replaceDashboardTextureImage(
  repo: DashboardTextureRepository,
  id: number,
  input: ImageUploadInput,
): void {
  const image = decodeImageUpload(input, MAX_DASHBOARD_TEXTURE_BYTES);
  if (!repo.replaceTextureImage(id, image)) throw new Error("That texture no longer exists.");
}

/** Renames a picture. Throws on an empty name or an unknown id. */
export function renameDashboardTexture(
  repo: DashboardTextureRepository,
  id: number,
  name: string,
): void {
  const cleanName = dashboardTextureNameSchema.parse(name);
  if (!repo.renameTexture(id, cleanName)) throw new Error("That texture no longer exists.");
}

/**
 * Removes a picture from the library.
 *
 * If it was the selected one the dashboard falls back to flat paper rather than
 * quietly promoting a neighbour — swapping in a picture the admin didn't choose
 * is a worse surprise than showing none. The repository clears the pointer.
 */
export function deleteDashboardTexture(repo: DashboardTextureRepository, id: number): void {
  if (!repo.deleteTexture(id)) throw new Error("That texture no longer exists.");
}

/** Points the dashboard at a library picture, or at none with `undefined`. */
export function selectDashboardTexture(
  repo: DashboardTextureRepository,
  id: number | undefined,
): void {
  if (!repo.selectTexture(id)) throw new Error("That texture no longer exists.");
}

/**
 * Sets whether the selected picture covers every authenticated screen or the
 * home dashboard alone (migration 0116).
 *
 * Takes no id: scope describes the selection, not a picture, so it survives
 * switching between textures. Turning it on with nothing selected is legal and
 * draws nothing — the flag is stored and takes effect when a picture is chosen.
 */
export function setDashboardTextureAppWide(
  repo: DashboardTextureRepository,
  appWide: boolean,
): void {
  repo.setAppWide(appWide);
}

/** Updates one picture's opacity / mode / blur, leaving its bytes in place. */
export function saveDashboardTextureSettings(
  repo: DashboardTextureRepository,
  id: number,
  input: DashboardTextureSettings,
): void {
  const settings = dashboardTextureSettingsSchema.parse(input);
  if (!repo.setSettings(id, settings)) throw new Error("That texture no longer exists.");
}

// `dashboardTextureCssVars` used to live here, emitting `--dashboard-texture-*`
// for a rule of the same name in globals.css. Both are gone (0116): there is now
// one `[data-app-texture]` rule fed by one namespace, and `resolveAppTexture` in
// src/lib/app-texture/ is what produces it -- because the picture behind a screen
// may come from here or from a module, and only that module knows which wins.
