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
import {
  moduleTextureChoiceSchema,
  moduleTextureSettingsSchema,
  moduleTextureSlugSchema,
  type ModuleTextureChoiceInput,
} from "./schema";
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

/**
 * Every module that does not inherit the app-wide texture.
 *
 * These are the modules an app-wide texture does not reach — whether because
 * they draw their own picture, a library one, or nothing at all. See
 * `src/lib/app-texture/`. Returns slugs; the caller resolves them to names.
 */
export function listModulesWithTexture(repo: ModuleTextureRepository): string[] {
  return repo.listSlugsWithImage();
}

/**
 * Sets which of the four sources a module draws (migration 0117).
 *
 * Validated at the boundary: a `'library'` choice must name a picture, and any
 * other choice must not. Leaves an uploaded picture in place, so a module that
 * switches to a library texture and back keeps its own without re-uploading.
 *
 * Does **not** check that `textureId` names a live library row. A deleted
 * picture is resolved as `inherit` at render time by
 * `src/lib/app-texture/` — validating here would only move the race, since the
 * admin can delete a library picture at any point after this returns.
 */
export function setModuleTextureChoice(
  repo: ModuleTextureRepository,
  moduleSlug: string,
  input: ModuleTextureChoiceInput,
): void {
  const choice = moduleTextureChoiceSchema.parse(input);
  repo.setChoice(moduleTextureSlugSchema.parse(moduleSlug), choice.source, choice.textureId);
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

// `moduleTextureCssVars` used to live here, emitting `--module-texture-*` for a
// rule of the same name in globals.css. Both are gone (0116): a module's picture
// and the app-wide one now share one `[data-app-texture]` rule and one namespace,
// and `resolveAppTexture` in src/lib/app-texture/ decides which of the two a
// screen draws. This module still answers only for itself.
