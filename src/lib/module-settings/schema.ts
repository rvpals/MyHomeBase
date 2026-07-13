import { z } from "zod";

export const moduleSettingSchema = z.object({
  id: z.number().int().positive(),
  moduleId: z.number().int().positive(),
  key: z.string().min(1),
  value: z.string().min(1),
  description: z.string().min(1).optional(),
});

export type ModuleSettingInput = z.infer<typeof moduleSettingSchema>;

// One entry from the admin editor. Not tied to an id — a save replaces the
// full set of entries for a module (see saveModuleSettings).
export const moduleSettingEntrySchema = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
  description: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional(),
  ),
});

export type ModuleSettingEntry = z.infer<typeof moduleSettingEntrySchema>;

export const moduleSettingsSaveSchema = z.object({
  moduleId: z.number().int().positive(),
  entries: z.array(moduleSettingEntrySchema),
});

export type ModuleSettingsSave = z.infer<typeof moduleSettingsSaveSchema>;
