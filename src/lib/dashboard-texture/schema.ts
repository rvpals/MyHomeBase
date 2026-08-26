import { z } from "zod";

/**
 * The display knobs, validated at the boundary.
 *
 * The bounds are the same ones the table CHECKs (migration 0063). Duplicated
 * deliberately: the CHECK is the last line of defence and reports a SQLite
 * error, while this reports something an admin screen can show. Neither is
 * redundant — a CLI caller reaches the same use-case without going through the
 * form.
 */
export const dashboardTextureSettingsSchema = z.object({
  opacity: z
    .number({ message: "Opacity must be a number." })
    .min(0, "Opacity cannot be negative.")
    .max(1, "Opacity cannot exceed 1."),
  mode: z.enum(["cover", "tile"], { message: "Choose either cover or tile." }),
  blur: z
    .number({ message: "Blur must be a number." })
    .int("Blur must be a whole number of pixels.")
    .min(0, "Blur cannot be negative.")
    .max(40, "Blur cannot exceed 40px."),
});

export type DashboardTextureSettingsInput = z.infer<typeof dashboardTextureSettingsSchema>;
