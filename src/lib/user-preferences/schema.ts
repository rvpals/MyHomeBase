import { z } from "zod";

// A stored row, validated on the way out of the database. `value` allows blank:
// "no favorite module" is the empty string, because preference_value is
// TEXT NOT NULL (see migrations/0044). The blank-to-undefined mapping happens in
// resolveUserPreferences, not here.
export const userPreferenceSchema = z.object({
  id: z.number().int().positive(),
  userId: z.number().int().positive(),
  key: z.string().min(1),
  value: z.string(),
});

export type UserPreferenceInput = z.infer<typeof userPreferenceSchema>;

/**
 * The boundary schema. Both the account server action and the CLI command parse
 * their raw input with this, so the web and the terminal accept exactly the same
 * thing (ARCHITECTURE.md — one use-case, two adapters).
 *
 * `favoriteModuleSlug` is optional and blank is coerced to `undefined`, so
 * "clear my favorite" is expressible: a `<select>` posting "" and a CLI passing
 * `--favorite ""` both mean the same thing. The slug is *not* validated against
 * the module list here — a schema can't know which modules exist, let alone
 * which this user can reach. `saveUserPreferences` takes the allowed slugs and
 * enforces that.
 */
export const userPreferencesUpdateSchema = z.object({
  favoriteModuleSlug: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().min(1).optional(),
  ),
  openFavoriteModuleOnStartup: z.boolean(),
});

export type UserPreferencesUpdate = z.infer<typeof userPreferencesUpdateSchema>;
