import { z } from "zod";

// The boundary schema for a stored run record. The repository parses through this,
// so a hand-edited `sys_scheduled_runs` row can't reach the UI as a bad shape.

export const scheduledRunStatusSchema = z.enum(["ok", "partial", "failed"]);

export const scheduledRunSchema = z.object({
  jobKey: z.string().min(1),
  lastRunAt: z.string().min(1),
  status: scheduledRunStatusSchema.optional(),
  detail: z.string().min(1).optional(),
});
