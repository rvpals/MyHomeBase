import { z } from "zod";
import { MODULE_ICON_NAMES } from "./icon-names";

export const moduleSchema = z.object({
  id: z.number().int().positive(),
  slug: z.string().min(1),
  shortName: z.string().min(1),
  longName: z.string().min(1),
  description: z.string().min(1).optional(),
  sequence: z.number().int(),
  isVisible: z.boolean(),
  icon: z.enum(MODULE_ICON_NAMES),
  // Defaulted so `resetToDefaults` and any other caller building a Module from
  // scratch doesn't have to state it — a fresh module has no artwork.
  hasCarouselImage: z.boolean().default(false),
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
