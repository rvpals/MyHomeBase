import { z } from "zod";

export const settingSchema = z.object({
  key: z.string().min(1),
  // Not `.min(1)`: STARTUP_MESSAGE stores a blank to mean "nothing to show".
  value: z.string(),
  description: z.string().min(1).optional(),
});

// Stays strict on purpose: this is what the admin Application Configuration screen
// posts, and blanking `application_name` there would leave the UI with no wordmark.
export const settingUpdateSchema = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
});

export type SettingUpdate = z.infer<typeof settingUpdateSchema>;

export const settingUpdateListSchema = z.array(settingUpdateSchema).min(1);

// The startup message is the one setting that is legitimately blank — blank is how
// "already dismissed" is stored — so it gets its own schema rather than loosening
// the one above for every setting.
export const startupMessageSchema = z.string().max(2000);
