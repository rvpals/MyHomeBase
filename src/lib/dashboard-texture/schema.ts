import { z } from "zod";

/**
 * The display knobs, validated at the boundary.
 *
 * The bounds are the same ones the table CHECKs (migrations 0063 and 0113).
 * Duplicated deliberately: the CHECK is the last line of defence and reports a
 * SQLite error, while this reports something an admin screen can show. Neither
 * is redundant — a CLI caller reaches the same use-case without going through
 * the form.
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

/**
 * What a texture may be called.
 *
 * Trimmed before the length check so a name of nothing but spaces is rejected
 * rather than stored — the gallery would render it as an unlabelled tile the
 * admin then cannot tell apart from its neighbours. 40 characters is what the
 * tile's caption can show without truncating; the column itself is unbounded
 * TEXT, so this is the only place the limit exists.
 */
export const dashboardTextureNameSchema = z
  .string({ message: "Give the texture a name." })
  .trim()
  .min(1, "Give the texture a name.")
  .max(40, "Keep the name under 40 characters.");
