import {
  decodeImageUpload,
  type DecodedImage,
  type ImageUploadInput,
} from "@/lib/shared/image-upload";
import { DEFAULT_MODULES } from "./defaults";
import type { ModuleRepository } from "./ports";
import {
  MAX_CAROUSEL_IMAGE_BYTES,
  moduleUpdateListSchema,
  type ModuleUpdate,
} from "./schema";
import type { Module } from "./types";

export function listModules(
  repo: ModuleRepository,
  options?: { includeHidden?: boolean },
): Module[] {
  return repo.listModules(options);
}

export function getModuleBySlug(repo: ModuleRepository, slug: string): Module | undefined {
  return repo.getModuleBySlug(slug);
}

export function updateModules(repo: ModuleRepository, updates: ModuleUpdate[]): Module[] {
  const validated = moduleUpdateListSchema.parse(updates);
  repo.updateAll(validated);
  return repo.listModules({ includeHidden: true });
}

export function resetModulesToDefaults(repo: ModuleRepository): Module[] {
  repo.resetToDefaults(DEFAULT_MODULES);
  return repo.listModules({ includeHidden: true });
}

// ---------------------------------------------------------------------------
// The carousel image. Validation is the shared `decodeImageUpload` — the mime
// allowlist (no SVG, because these bytes are served from our own origin) is one
// rule for the whole app and must not be re-derived per module.
// ---------------------------------------------------------------------------

/** Replaces a module's carousel graphic. Throws on a bad type or an oversized file. */
export function setModuleCarouselImage(
  repo: ModuleRepository,
  slug: string,
  input: ImageUploadInput,
): void {
  requireModule(repo, slug);
  repo.setCarouselImage(slug, decodeImageUpload(input, MAX_CAROUSEL_IMAGE_BYTES));
}

/** Clears it, so the carousel falls back to the module's icon glyph. */
export function removeModuleCarouselImage(repo: ModuleRepository, slug: string): void {
  requireModule(repo, slug);
  repo.setCarouselImage(slug, undefined);
}

/**
 * The image bytes, for the serving route only.
 *
 * Everything else should read `Module.hasCarouselImage`, which costs nothing —
 * see `migrations/0040_add_carousel_image_to_modules.md`.
 */
export function getModuleCarouselImage(
  repo: ModuleRepository,
  slug: string,
): DecodedImage | undefined {
  return repo.getCarouselImage(slug);
}

/**
 * Rejects an unknown slug before writing.
 *
 * `setCarouselImage` is an UPDATE, so without this a typo'd slug would silently
 * affect zero rows and report success.
 */
function requireModule(repo: ModuleRepository, slug: string): Module {
  const appModule = repo.getModuleBySlug(slug);
  if (!appModule) throw new Error(`No module with the slug "${slug}".`);
  return appModule;
}
