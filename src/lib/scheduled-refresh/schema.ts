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

// The run-record schemas moved to `@/lib/scheduled-jobs` with the record itself.
// Re-exported so existing importers keep resolving.
export { scheduledRunSchema, scheduledRunStatusSchema } from "@/lib/scheduled-jobs/schema";
