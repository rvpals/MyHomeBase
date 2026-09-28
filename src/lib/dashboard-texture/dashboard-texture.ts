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

/** Updates one picture's opacity / mode / blur, leaving its bytes in place. */
export function saveDashboardTextureSettings(
  repo: DashboardTextureRepository,
  id: number,
  input: DashboardTextureSettings,
): void {
  const settings = dashboardTextureSettingsSchema.parse(input);
  if (!repo.setSettings(id, settings)) throw new Error("That texture no longer exists.");
}

/**
 * The CSS custom properties for the texture layer, or `undefined` when there is
 * nothing to draw.
 *
 * Returned as a record rather than a finished `style` string so the caller
 * decides where it lands (the dashboard writes it onto its page container, next
 * to the theme tokens). `undefined` — rather than a layer at opacity 0 — is what
 * lets the page skip the element entirely: an empty fixed div that paints
 * nothing is still a compositing layer on every scroll.
 *
 * The URL carries `?v=<updatedAt>` because the serving route sends a 5-minute
 * max-age; without it, replacing or switching the picture would appear to do
 * nothing. `updatedAt` belongs to the selected row, so selecting a different
 * texture changes it too.
 */
export function dashboardTextureCssVars(
  texture: DashboardTexture,
): Record<string, string> | undefined {
  if (!texture.hasImage) return undefined;

  return {
    "--dashboard-texture-image": `url("/api/dashboard/texture?v=${encodeURIComponent(
      texture.updatedAt,
    )}")`,
    "--dashboard-texture-opacity": String(texture.opacity),
    // `cover` stretches one copy over the viewport; `tile` repeats it at its
    // natural size. Two properties rather than one shorthand, because
    // background-size and background-repeat have to disagree between the modes.
    "--dashboard-texture-size": texture.mode === "cover" ? "cover" : "auto",
    "--dashboard-texture-repeat": texture.mode === "cover" ? "no-repeat" : "repeat",
    "--dashboard-texture-blur": `${texture.blur}px`,
  };
}
