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
  // The Clock's display options. `.catch` on the face and `.default` on the whole
  // object for the same reason as the fields above: this schema is the boundary for
  // the CLI too, so a command about favorites must not have to name a clock face, and
  // an unrecognised face from an older client is corrected rather than rejecting the
  // save and taking the other fields with it.
  clock: z
    .object({
      face: z.enum(["digital", "analog"]).catch("digital"),
      showDate: z.boolean(),
      showWeather: z.boolean(),
      showWeekday: z.boolean(),
    })
    .default({ face: "digital", showDate: true, showWeather: true, showWeekday: true }),
});

/**
 * One floating component's state, the boundary for `saveFloatingState`.
 *
 * Separate from the form schema above because it is a separate use-case with a
 * separate trigger: this fires every time a reader minimizes or closes a window,
 * where the form fires when they press Save. Folding the two together would mean
 * either write had to carry the other's whole payload.
 *
 * Neither field gets a `.catch`: an unknown id or a nonsense state here is a bug in
 * the caller, not an older client sending a field we since renamed, and silently
 * writing a corrected value would hide it.
 */
export const floatingStateUpdateSchema = z.object({
  id: z.enum(["clock", "calculator", "scratchpad"]),
  state: z.enum(["closed", "minimized", "open"]),
});

export type FloatingStateUpdate = z.infer<typeof floatingStateUpdateSchema>;

/**
 * One component's docked corner, the boundary for `saveFloatingCorner`.
 *
 * Its own schema for the same reason the state has one: a corner is set once on the
 * Account screen, a state changes on every minimize, and one combined write would let
 * either clobber the other's field.
 */
export const floatingCornerUpdateSchema = z.object({
  id: z.enum(["clock", "calculator", "scratchpad"]),
  corner: z.enum(["bottom-right", "bottom-left", "top-right", "top-left"]),
});

export type FloatingCornerUpdate = z.infer<typeof floatingCornerUpdateSchema>;

/**
 * The calculator's remembered state, the boundary for `saveCalculatorState`.
 *
 * Its own schema and its own use-case for the same reason the floating state has one:
 * this fires when a calculation completes or the angle mode flips, not when the
 * Preferences form is submitted. Both fields are optional so either can be written
 * alone — toggling degrees must not clear the last result.
 */
export const calculatorStateUpdateSchema = z.object({
  angleMode: z.enum(["deg", "rad"]).optional(),
  // `.max` because this is display text reaching a stored row; the formatter never
  // produces anything near it, so the cap only ever catches a bad caller.
  lastResult: z.string().trim().max(100).optional(),
});

export type CalculatorStateUpdate = z.infer<typeof calculatorStateUpdateSchema>;

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
