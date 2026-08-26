import { z } from "zod";
import { REFRESH_INTERVALS } from "./types";

// The boundary schema for the auto-refresh settings. Both front-ends validate
// through this: the server action for the settings form, and the CLI for its flags.

export const refreshIntervalSchema = z.enum(REFRESH_INTERVALS);

export const scheduledRefreshSettingsSchema = z.object({
  autoRefreshEnabled: z.boolean(),
  autoRefreshInterval: refreshIntervalSchema,
});

export type ScheduledRefreshSettingsInput = z.infer<typeof scheduledRefreshSettingsSchema>;

export const scheduledRunStatusSchema = z.enum(["ok", "partial", "failed"]);

export const scheduledRunSchema = z.object({
  jobKey: z.string().min(1),
  lastRunAt: z.string().min(1),
  status: scheduledRunStatusSchema.optional(),
  detail: z.string().min(1).optional(),
});
