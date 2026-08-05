import { z } from "zod";
import { DASHBOARD_WIDGET_IDS } from "./types";

export const dashboardWidgetIdSchema = z.enum(DASHBOARD_WIDGET_IDS);

export const dashboardWidgetPreferenceSchema = z.object({
  id: dashboardWidgetIdSchema,
  visible: z.boolean(),
});

/**
 * The whole dashboard layout as it arrives from a form or a CLI arg.
 *
 * Every widget must appear exactly once: a partial list would leave the resolver
 * guessing where the missing ones go, and a duplicate would render a widget twice.
 * Both are rejected here rather than tolerated downstream.
 */
export const dashboardWidgetsSchema = z
  .array(dashboardWidgetPreferenceSchema)
  .length(DASHBOARD_WIDGET_IDS.length, "Every widget must be listed exactly once.")
  .refine(
    (preferences) => new Set(preferences.map((preference) => preference.id)).size === preferences.length,
    { message: "A widget is listed more than once." },
  );

export type DashboardWidgetsInput = z.infer<typeof dashboardWidgetsSchema>;
