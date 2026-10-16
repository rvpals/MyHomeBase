import { z } from "zod";
import { IMAGE_UPLOAD_MIME_TYPES } from "@/lib/shared/image-upload";
import { MODULE_ICON_NAMES } from "./icon-names";

/**
 * One icon name, on its own.
 *
 * Split out of `moduleSchema` because the icon is now settable by itself (see
 * `setModuleIcon`) and validating it should not require inventing the rest of a
 * module row.
 */
export const moduleIconNameSchema = z.enum(MODULE_ICON_NAMES);

export const moduleSchema = z.object({
  id: z.number().int().positive(),
  slug: z.string().min(1),
  shortName: z.string().min(1),
  longName: z.string().min(1),
  description: z.string().min(1).optional(),
  sequence: z.number().int(),
  isVisible: z.boolean(),
  icon: moduleIconNameSchema,
  // Defaulted so `resetToDefaults` and any other caller building a Module from
  // scratch doesn't have to state it — a fresh module has no artwork.
  hasCarouselImage: z.boolean().default(false),
  // Same reasoning as `hasCarouselImage` above — a module built from scratch
  // has no upload, and saying so four times in `DEFAULT_MODULES` says nothing.
  hasCustomIcon: z.boolean().default(false),
  customIconKind: z.enum(["svg", "image"]).optional(),
  updatedAt: z.string().optional(),
});

export type ModuleInput = z.infer<typeof moduleSchema>;

/**
 * Cap for a module's carousel image.
 *
 * 2 MB, well above the other image columns (128–512 KB): those are small icons,
 * this is displayed at ~200px on a retina screen and is the one graphic a reader
 * sees full size. Stored as uploaded — nothing resizes it — so this doubles as
 * the page-weight budget for the home screen.
 */
export const MAX_CAROUSEL_IMAGE_BYTES = 2 * 1024 * 1024;

// Editable fields from the admin UI. Sequence isn't included — it's derived from
// array order when a batch of updates is saved (see updateModules).
export const moduleUpdateSchema = z.object({
  slug: z.string().min(1),
  shortName: z.string().min(1),
  longName: z.string().min(1),
  description: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional(),
  ),
  isVisible: z.boolean(),
});

export type ModuleUpdate = z.infer<typeof moduleUpdateSchema>;

export const moduleUpdateListSchema = z.array(moduleUpdateSchema).min(1);

/**
 * Cap for a module's uploaded icon.
 *
 * 256 KB, matching `ICON_OVERRIDE_MAX_BYTES` rather than the carousel's 2 MB:
 * this draws at 16-20px in the nav, and the raster path normalises it down to a
 * 256px PNG anyway. The carousel image is the one graphic a reader sees full
 * size, which is why that one gets eight times the budget.
 */
export const MAX_MODULE_ICON_BYTES = 256 * 1024;

/**
 * An uploaded module icon.
 *
 * Shaped like `iconOverrideInputSchema` in `src/lib/icons/schema.ts` — the same
 * two payloads, discriminated the same way — because it is the same job done
 * against a different column. SVG arrives as *text* so it can be sanitized as
 * markup and stored as an inner body that inherits `currentColor`; raster
 * arrives as base64 and goes through the shared mime allowlist, which excludes
 * SVG precisely because these bytes are served from our own origin.
 */
export const svgModuleIconSchema = z.object({
  slug: z.string().min(1, "Pick a module."),
  kind: z.literal("svg"),
  /** The raw file contents, straight from the upload. */
  source: z
    .string()
    .min(1, "That SVG file is empty.")
    .max(MAX_MODULE_ICON_BYTES, "That SVG is too large — keep it under 256 KB."),
});

export const rasterModuleIconSchema = z.object({
  slug: z.string().min(1, "Pick a module."),
  kind: z.literal("raster"),
  mimeType: z.enum(IMAGE_UPLOAD_MIME_TYPES, {
    message: "Use an SVG, PNG, JPEG, WebP or GIF image.",
  }),
  base64Data: z.string().min(1, "That image is empty."),
});

export const moduleCustomIconInputSchema = z.discriminatedUnion("kind", [
  svgModuleIconSchema,
  rasterModuleIconSchema,
]);

export type ModuleCustomIconInput = z.infer<typeof moduleCustomIconInputSchema>;
