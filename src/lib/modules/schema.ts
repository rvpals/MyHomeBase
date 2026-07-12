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
});

export type ModuleInput = z.infer<typeof moduleSchema>;

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
