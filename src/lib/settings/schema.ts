import { z } from "zod";

export const settingSchema = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
  description: z.string().min(1).optional(),
});

export const settingUpdateSchema = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
});

export type SettingUpdate = z.infer<typeof settingUpdateSchema>;

export const settingUpdateListSchema = z.array(settingUpdateSchema).min(1);
