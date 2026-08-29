import { z } from "zod";
import { HOME_WIDGET_IDS } from "./types";

export const homeWidgetIdSchema = z.enum(HOME_WIDGET_IDS);

export const homeWidgetPreferenceSchema = z.object({
  id: homeWidgetIdSchema,
  visible: z.boolean(),
});

/**
 * The whole home layout as it arrives from the admin form or a CLI arg.
 *
 * Every card must appear exactly once: a partial list would leave the resolver
 * guessing where the missing ones go, and a duplicate would draw a card twice.
 * Both are rejected here rather than tolerated downstream.
 */
export const homeWidgetsSchema = z
  .array(homeWidgetPreferenceSchema)
  .length(HOME_WIDGET_IDS.length, "Every widget must be listed exactly once.")
  .refine(
    (preferences) => new Set(preferences.map((preference) => preference.id)).size === preferences.length,
    { message: "A widget is listed more than once." },
  );

export type HomeWidgetsInput = z.infer<typeof homeWidgetsSchema>;
