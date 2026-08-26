// A module's background picture: read the settings, replace the picture, and turn
// the stored knobs into the CSS the module shell emits.
//
// Generalised from `src/lib/dashboard-texture/` rather than copied from it: same
// shape, same reasoning, keyed by module slug instead of a pinned single row. The
// home screen keeps its own table because it is not a module and has no slug --
// see migrations/0064_create_module_texture.md.
//
// Pure functions over a repository port -- no react, no next, no DOM.

import {
  decodeImageUpload,
  type DecodedImage,
  type ImageUploadInput,
} from "@/lib/shared/image-upload";
import type { ModuleTextureRepository } from "./ports";
import { moduleTextureSettingsSchema, moduleTextureSlugSchema } from "./schema";
import type { ModuleTexture, ModuleTextureSettings } from "./types";

/**
 * The size cap for a module background.
 *
 * The same 4 MB as the dashboard's: this picture covers a desktop viewport too,
 * so it needs real resolution, but the bytes travel through a server action and
 * an uncapped upload is how a 12 MP phone photo becomes a failed request with no
 * useful error. Enough for a 2560px-wide JPEG or WebP at sensible quality.
 */
export const MAX_MODULE_TEXTURE_BYTES = 4 * 1024 * 1024;

/** One module's settings row. Cheap — carries `hasImage`, never the bytes. */
export function getModuleTexture(
  repo: ModuleTextureRepository,
  moduleSlug: string,
): ModuleTexture {
  return repo.getTexture(moduleTextureSlugSchema.parse(moduleSlug));
}

/**
 * The picture's bytes, for the serving route only.
 *
 * Everything else reads `ModuleTexture.hasImage`, which costs nothing — see
 * `migrations/0064_create_module_texture.md`.
 */
export function getModuleTextureImage(
  repo: ModuleTextureRepository,
  moduleSlug: string,
): DecodedImage | undefined {
  return repo.getTextureImage(moduleTextureSlugSchema.parse(moduleSlug));
}

/** Replaces the picture. Throws on a disallowed type or an oversized file. */
export function setModuleTextureImage(
  repo: ModuleTextureRepository,
  moduleSlug: string,
  input: ImageUploadInput,
): void {
  repo.setImage(
    moduleTextureSlugSchema.parse(moduleSlug),
    decodeImageUpload(input, MAX_MODULE_TEXTURE_BYTES),
  );
}

/** Clears the picture, so the module goes back to the theme's flat paper. */
export function removeModuleTextureImage(
  repo: ModuleTextureRepository,
  moduleSlug: string,
): void {
  repo.setImage(moduleTextureSlugSchema.parse(moduleSlug), undefined);
}

/** Updates opacity / mode / blur, leaving the picture in place. */
export function saveModuleTextureSettings(
  repo: ModuleTextureRepository,
  moduleSlug: string,
  input: ModuleTextureSettings,
): void {
  repo.setSettings(
    moduleTextureSlugSchema.parse(moduleSlug),
    moduleTextureSettingsSchema.parse(input),
  );
}

/**
 * The CSS custom properties for the texture layer, or `undefined` when there is
 * nothing to draw.
 *
 * Returned as a record rather than a finished `style` string so the caller decides
 * where it lands. `undefined` — rather than a layer at opacity 0 — is what lets
 * the shell skip the element entirely: an empty fixed div that paints nothing is
 * still a compositing layer on every scroll.
 *
 * The URL carries `?v=<updatedAt>` because the serving route sends a 5-minute
 * max-age; without it, replacing the picture would appear to do nothing.
 */
export function moduleTextureCssVars(
  texture: ModuleTexture,
): Record<string, string> | undefined {
  if (!texture.hasImage) return undefined;

  return {
    "--module-texture-image": `url("/api/modules/${encodeURIComponent(
      texture.moduleSlug,
    )}/texture?v=${encodeURIComponent(texture.updatedAt)}")`,
    "--module-texture-opacity": String(texture.opacity),
    // `cover` stretches one copy over the viewport; `tile` repeats it at its
    // natural size. Two properties rather than one shorthand, because
    // background-size and background-repeat have to disagree between the modes.
    "--module-texture-size": texture.mode === "cover" ? "cover" : "auto",
    "--module-texture-repeat": texture.mode === "cover" ? "no-repeat" : "repeat",
    "--module-texture-blur": `${texture.blur}px`,
  };
}
