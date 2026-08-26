// The home dashboard's background picture: read the settings, replace the
// picture, and turn the stored knobs into the CSS the layout emits.
//
// Pure functions over a repository port — no react, no next, no DOM.

import {
  decodeImageUpload,
  type DecodedImage,
  type ImageUploadInput,
} from "@/lib/shared/image-upload";
import type { DashboardTextureRepository } from "./ports";
import { dashboardTextureSettingsSchema } from "./schema";
import type { DashboardTexture, DashboardTextureSettings } from "./types";

/**
 * The size cap for a dashboard background.
 *
 * Larger than a 20px category icon's allowance because this one legitimately
 * covers a desktop viewport — but still a cap: the bytes travel through a server
 * action, and an uncapped upload is how a 12 MP phone photo becomes a failed
 * request with no useful error. 4 MB is comfortably enough for a 2560px-wide
 * JPEG or WebP at sensible quality.
 */
export const MAX_DASHBOARD_TEXTURE_BYTES = 4 * 1024 * 1024;

/** The settings row. Cheap — carries `hasImage`, never the bytes. */
export function getDashboardTexture(repo: DashboardTextureRepository): DashboardTexture {
  return repo.getTexture();
}

/**
 * The picture's bytes, for the serving route only.
 *
 * Everything else reads `DashboardTexture.hasImage`, which costs nothing — see
 * `migrations/0063_create_dashboard_texture.md`.
 */
export function getDashboardTextureImage(
  repo: DashboardTextureRepository,
): DecodedImage | undefined {
  return repo.getTextureImage();
}

/** Replaces the picture. Throws on a disallowed type or an oversized file. */
export function setDashboardTextureImage(
  repo: DashboardTextureRepository,
  input: ImageUploadInput,
): void {
  repo.setImage(decodeImageUpload(input, MAX_DASHBOARD_TEXTURE_BYTES));
}

/** Clears the picture, so the dashboard goes back to the theme's flat paper. */
export function removeDashboardTextureImage(repo: DashboardTextureRepository): void {
  repo.setImage(undefined);
}

/** Updates opacity / mode / blur, leaving the picture in place. */
export function saveDashboardTextureSettings(
  repo: DashboardTextureRepository,
  input: DashboardTextureSettings,
): void {
  repo.setSettings(dashboardTextureSettingsSchema.parse(input));
}

/**
 * The CSS custom properties for the texture layer, or `undefined` when there is
 * nothing to draw.
 *
 * Returned as a record rather than a finished `style` string so the caller
 * decides where it lands (the layout writes it into a `:root` block, next to the
 * theme tokens). `undefined` — rather than a layer at opacity 0 — is what lets
 * the layout skip the element entirely: an empty fixed div that paints nothing
 * is still a compositing layer on every scroll.
 *
 * The URL carries `?v=<updatedAt>` because the serving route sends a 5-minute
 * max-age; without it, replacing the picture would appear to do nothing.
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
