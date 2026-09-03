import {
  decodeImageUpload,
  type DecodedImage,
  type ImageUploadInput,
} from "@/lib/shared/image-upload";
import { DEFAULT_MODULES } from "./defaults";
import type { CarouselImageProcessor, ModuleRepository } from "./ports";
import { resizeCarouselImage } from "./resize-carousel-image";
import {
  MAX_CAROUSEL_IMAGE_BYTES,
  moduleIconNameSchema,
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

/**
 * Sets one module's glyph.
 *
 * Its own use-case rather than a field on `ModuleUpdate`, because the picker
 * writes on pick instead of through the admin form's Save button — the same
 * trade the carousel graphic makes below. Batching it would mean a chosen glyph
 * sits unsaved in form state while the rail beside it still shows the old one.
 *
 * The name is validated against `MODULE_ICON_NAMES`, so an icon that no glyph
 * set can draw is rejected here rather than falling back to `building` forever
 * once it is in the database.
 */
export function setModuleIcon(repo: ModuleRepository, slug: string, icon: string): void {
  requireModule(repo, slug);
  repo.setIcon(slug, moduleIconNameSchema.parse(icon));
}

// ---------------------------------------------------------------------------
// The carousel image. Validation is the shared `decodeImageUpload` — the mime
// allowlist (no SVG, because these bytes are served from our own origin) is one
// rule for the whole app and must not be re-derived per module.
// ---------------------------------------------------------------------------

/**
 * Replaces a module's carousel graphic. Throws on a bad type or an oversized file.
 *
 * `processor` is optional so the CLI and the tests can store bytes verbatim, but
 * the web upload always passes it — without it a 2 MB original is stored whole
 * and then downloaded whole to fill a 192px tile. The cap stays checked against
 * the *incoming* file, not the resized result: it is there to stop a huge
 * request body, and shrinking afterwards shouldn't let a 50 MB upload through.
 */
export async function setModuleCarouselImage(
  repo: ModuleRepository,
  slug: string,
  input: ImageUploadInput,
  processor?: CarouselImageProcessor,
): Promise<void> {
  requireModule(repo, slug);
  const decoded = decodeImageUpload(input, MAX_CAROUSEL_IMAGE_BYTES);
  const stored = processor ? await resizeCarouselImage(processor, decoded) : decoded;
  repo.setCarouselImage(slug, { data: stored.data, mimeType: stored.mimeType });
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
