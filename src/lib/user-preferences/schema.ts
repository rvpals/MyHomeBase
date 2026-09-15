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
  // Unlike the favorite, this *is* validated here: the set of styles is closed
  // and known at compile time, so a schema can enforce it without knowing
  // anything about the database or the user. `.catch` rather than `.default`
  // so an unrecognised value from an older client is corrected to the default
  // instead of rejecting the whole save and losing the other fields with it.
  compactNavStyle: z.enum(["drill-in", "segmented"]).catch("drill-in"),
  // The whole location or nothing — see `WeatherLocation`. `null` is the wire form
  // of "clear it", distinct from the field being absent from an older client's
  // payload, which `.optional()` leaves alone.
  weatherLocation: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      name: z.string().min(1).max(200),
    })
    .nullish(),
  // `.catch` for the same reason as the nav style: a stray value shouldn't reject
  // the save and take the other fields down with it. `.default` on top of that so an
  // omitted field is "no opinion, use Fahrenheit" rather than a validation failure —
  // this schema is the boundary for the CLI too, and a command about favorites
  // shouldn't have to name a temperature unit to run.
  weatherUnit: z.enum(["celsius", "fahrenheit"]).catch("fahrenheit").default("fahrenheit"),
});

/**
 * `z.input`, not `z.infer` — this is the type of what a *caller* hands in, before
 * the schema applies its defaults. `z.infer` describes the parsed result, in which
 * every defaulted field is required, so it would force the CLI and every test to
 * name a temperature unit just to save a favorite. The parsed (output) shape is what
 * `saveUserPreferences` works with internally, and it gets that from `.parse()`.
 *
 * Matches how the weather and geocoding schemas in this app already type their
 * boundary inputs.
 */
export type UserPreferencesUpdate = z.input<typeof userPreferencesUpdateSchema>;
