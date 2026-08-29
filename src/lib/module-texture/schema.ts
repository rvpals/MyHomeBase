import { z } from "zod";

/**
 * The display knobs, validated at the boundary.
 *
 * The bounds are the same ones the table CHECKs (migration 0064). Duplicated
 * deliberately: the CHECK is the last line of defence and reports a SQLite
 * error, while this reports something a configuration screen can show. Neither is
 * redundant — a CLI caller reaches the same use-case without going through the
 * form.
 */
export const moduleTextureSettingsSchema = z.object({
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

export type ModuleTextureSettingsInput = z.infer<typeof moduleTextureSettingsSchema>;

/**
 * A module slug, validated because it is the table's primary key and arrives from
 * a route parameter. Trimmed and lowercased so `/modules/Music-Library` cannot
 * create a second row that shadows the real one.
 */
export const moduleTextureSlugSchema = z
  .string({ message: "A module slug is required." })
  .trim()
  // Lowercased BEFORE the pattern is checked, not after. With the transform last the
  // regex saw the raw route param, so `Music-Library` was rejected outright rather than
  // normalised -- which is the one case the lowercasing exists for, and it meant the
  // shadow-row guard never actually ran.
  .toLowerCase()
  .min(1, "A module slug is required.")
  .max(64, "That module slug is too long.")
  .regex(/^[a-z0-9-]+$/, "A module slug is lowercase letters, numbers and hyphens.");
