import {
  decodeImageUpload,
  type DecodedImage,
  type ImageUploadInput,
} from "@/lib/shared/image-upload";
// Imported from the individual files rather than the `@/lib/icons` barrel.
// `slots.test.ts` imports MODULE_ICON_NAMES back out of `@/lib/modules`, so
// going through both barrels would close a module cycle for no benefit — these
// three symbols have no dependency on the slot registry.
import { normalizeIconImage } from "@/lib/icons/normalize-image";
import { sanitizeSvg } from "@/lib/icons/sanitize-svg";
import type { IconImageProcessor } from "@/lib/icons/ports";
import { DEFAULT_MODULES } from "./defaults";
import type { CarouselImageProcessor, ModuleRepository } from "./ports";
import { resizeCarouselImage } from "./resize-carousel-image";
import {
  MAX_CAROUSEL_IMAGE_BYTES,
  MAX_MODULE_ICON_BYTES,
  moduleCustomIconInputSchema,
  moduleIconNameSchema,
  moduleUpdateListSchema,
  type ModuleCustomIconInput,
  type ModuleUpdate,
} from "./schema";
import type { Module, ModuleCustomIcon, ModuleCustomIconSummary } from "./types";

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
// The custom icon — artwork uploaded in place of the picked glyph.
//
// Shares the whole pipeline with slot overrides (`src/lib/icons/`) rather than
// re-deriving it: `sanitizeSvg` for markup, `normalizeIconImage` for raster.
// Both are solving the identical problem — an upload that has to read correctly
// at 16-20px and must not be able to carry script back out of our own origin —
// and a second, subtly different copy of those rules is exactly the drift that
// `image-upload.ts` was promoted out of lib/expense to prevent.
//
// What is NOT shared is the storage key. A slot override is keyed by (slot, set)
// so a glyph drawn for one icon set never leaks into another. A module icon is
// set-independent: it is the module's identity, not a note in a visual style.
// See migrations/0150_module_custom_icon.md.
// ---------------------------------------------------------------------------

/**
 * Stores an uploaded icon for one module, replacing whatever was there.
 *
 * `processor` is optional for the same reason `setModuleCarouselImage`'s is —
 * tests and any SVG-only caller need not supply one — but the web action always
 * passes it. Without it a raster is stored exactly as it arrived, which is the
 * muddy-grey-block outcome `normalizeIconImage` exists to prevent.
 */
export async function setModuleCustomIcon(
  repo: ModuleRepository,
  input: ModuleCustomIconInput,
  processor?: IconImageProcessor,
): Promise<void> {
  const parsed = moduleCustomIconInputSchema.parse(input);
  requireModule(repo, parsed.slug);

  if (parsed.kind === "svg") {
    const { body, width, height } = sanitizeSvg(parsed.source);
    repo.setCustomIcon(parsed.slug, { svgBody: body, svgWidth: width, svgHeight: height });
    return;
  }

  const { data, mimeType } = decodeImageUpload(
    { mimeType: parsed.mimeType, base64Data: parsed.base64Data },
    MAX_MODULE_ICON_BYTES,
  );

  // The same two-failures split `saveOverride` makes, and it is worth keeping
  // identical. A processor that is UNAVAILABLE is an install problem: storing
  // the raw upload would "work" while quietly producing the bad icon this
  // pipeline exists to prevent, so it propagates. A single image being
  // UNREADABLE is the reader's problem and must not cost them the upload — the
  // bytes already passed the mime allowlist and the size cap.
  let stored: ModuleCustomIcon = { data, mimeType };
  if (processor) {
    try {
      const normalized = await normalizeIconImage(processor, data);
      stored = { data: normalized.data, mimeType: normalized.mimeType };
    } catch (error) {
      if (error instanceof Error && /Image processing is unavailable/.test(error.message)) {
        throw error;
      }
    }
  }

  repo.setCustomIcon(parsed.slug, stored);
}

/**
 * Every uploaded module icon, keyed by slug — what the nav resolves against.
 *
 * Returns a plain record rather than the repository's array because every
 * consumer is a render-time lookup by slug, and building the index once per
 * page beats doing a `find` per nav row.
 */
export function getModuleCustomIconMap(
  repo: ModuleRepository,
): Record<string, ModuleCustomIconSummary> {
  const map: Record<string, ModuleCustomIconSummary> = {};
  for (const icon of repo.listCustomIcons()) map[icon.slug] = icon;
  return map;
}

/** Clears it, so the module falls back to its picked glyph. */
export function removeModuleCustomIcon(repo: ModuleRepository, slug: string): void {
  requireModule(repo, slug);
  repo.setCustomIcon(slug, undefined);
}

/**
 * The icon payload, for the serving route only.
 *
 * Everything that renders should read `Module.hasCustomIcon` and
 * `Module.customIconKind`, which cost nothing — see
 * `migrations/0150_module_custom_icon.md`.
 */
export function getModuleCustomIcon(
  repo: ModuleRepository,
  slug: string,
): ModuleCustomIcon | undefined {
  return repo.getCustomIcon(slug);
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
 * `setCarouselImage` and `setCustomIcon` are both an UPDATE, so without this a
 * typo'd slug would silently affect zero rows and report success.
 */
function requireModule(repo: ModuleRepository, slug: string): Module {
  const appModule = repo.getModuleBySlug(slug);
  if (!appModule) throw new Error(`No module with the slug "${slug}".`);
  return appModule;
}
