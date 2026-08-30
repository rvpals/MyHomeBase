import type { ColorTheme, ColorThemeTokens } from "@/lib/settings";

/**
 * A theme as it exists in the database.
 *
 * Extends the code-defined `ColorTheme` shape rather than replacing it, so everything
 * that already renders a theme — the `:root` block in the root layout, the manifest,
 * the picker cards — keeps taking the same object it always took.
 */
export interface StoredColorTheme extends ColorTheme {
  /**
   * True for the eight themes migration 0076 seeded.
   *
   * Means "there is a definition in `COLOR_THEMES` to fall back to", NOT "read-only":
   * a built-in can be edited freely. What it actually controls is two things — a
   * built-in cannot be deleted, and a built-in can be RESET to its code definition.
   */
  isBuiltin: boolean;
  /** Where it sits on the picker. Built-ins 10..80; user themes default to 100. */
  sortOrder: number;
  updatedAt: string;
}

/** One theme on its way to storage. No `isBuiltin` — a write may never change it. */
export interface ColorThemeWrite {
  id: string;
  name: string;
  description: string;
  tokens: ColorThemeTokens;
  sortOrder: number;
}
