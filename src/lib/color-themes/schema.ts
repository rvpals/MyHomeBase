// The boundary validation for a user-built color theme. Both the admin action and the
// CLI parse through these, so neither can write a row the other would not accept.

import { z } from "zod";
import { FONT_KEYS } from "@/lib/settings";

/**
 * A six-digit hex color.
 *
 * Six digits only — no `#abc` shorthand, no `rgb()`, no named colors. The value is
 * interpolated straight into a `:root` declaration in src/app/layout.tsx and is also
 * shown in an `<input type="color">`, which only speaks `#rrggbb`. Accepting other forms
 * would mean normalising them in two places.
 *
 * Mirrors the GLOB CHECK in migration 0076. Duplicated deliberately, same reasoning as
 * `dashboardTextureSettingsSchema`: the CHECK is the last line of defence and reports a
 * SQLite error, this reports something an admin screen can show.
 */
export const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex color like #1A2B3C.");

const fontKeySchema = z.enum(FONT_KEYS, {
  message: "Pick one of the app's seven fonts.",
});

export const colorThemeTokensSchema = z.object({
  paper: hexColorSchema,
  paperRaised: hexColorSchema,
  ink: hexColorSchema,
  line: hexColorSchema,
  muted: hexColorSchema,
  mutedInverse: hexColorSchema,
  brass: hexColorSchema,
  brassDark: hexColorSchema,
  brassSoft: hexColorSchema,
  fonts: z.object({
    display: fontKeySchema,
    body: fontKeySchema,
    mono: fontKeySchema,
  }),
});

/**
 * The id doubles as the value stored in `sys_app_settings.color_theme` and as a React
 * key, so it is held to a slug: lowercase, digits, single hyphens, no leading or
 * trailing hyphen. Generated from the name for a new theme, and never editable
 * afterwards — changing it would orphan the setting pointing at it, the same trap
 * icon slot ids have.
 */
export const colorThemeIdSchema = z
  .string()
  .trim()
  .min(2, "An id needs at least 2 characters.")
  .max(40, "Keep the id under 40 characters.")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use lowercase letters, numbers and single hyphens — like sea-glass.",
  );

export const colorThemeWriteSchema = z.object({
  id: colorThemeIdSchema,
  name: z.string().trim().min(1, "Give the theme a name.").max(40, "Keep the name under 40 characters."),
  // Blank is allowed: the description is a nicety on the picker card, and forcing one
  // would make duplicating a theme a two-field chore.
  description: z.string().trim().max(120, "Keep the description under 120 characters.").default(""),
  tokens: colorThemeTokensSchema,
  sortOrder: z.number().int().min(0).max(9999).default(100),
});

export type ColorThemeWriteInput = z.input<typeof colorThemeWriteSchema>;

/** Renaming is not offered, so an update reuses the write schema wholesale. */
export const deleteColorThemeSchema = z.object({ id: colorThemeIdSchema });

/** Turns a display name into a candidate slug id. */
export function slugifyThemeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}
