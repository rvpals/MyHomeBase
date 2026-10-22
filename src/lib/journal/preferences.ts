import type { DashboardTextureItem } from "@/lib/dashboard-texture";
import type { ModuleSetting } from "@/lib/module-settings";
import type {
  JournalHandwritingSize,
  JournalPreferences,
  JournalTemperatureUnit,
} from "./types";
import { parseExcludedWords, serializeExcludedWords } from "./word-stats";

// Module-settings keys the journal preferences are stored under.
export const JOURNAL_SETTING_KEYS = {
  defaultLatitude: "default_latitude",
  defaultLongitude: "default_longitude",
  defaultLocationName: "default_location_name",
  temperatureUnit: "temperature_unit",
  photoRoot: "photo_root",
  handwritingSize: "handwriting_size",
  reviewBeforeCalendarImport: "review_before_calendar_import",
  excludedWords: "excluded_words",
  contentTextureId: "content_texture_id",
  contentTextureOpacity: "content_texture_opacity",
  contentTextColor: "content_text_color",
} as const;

/**
 * The strength the Content background draws at when it has not been tuned.
 *
 * 0.10, the full-page figure rather than the 0.15 a navigation column or a
 * personal toolbar uses. A Content textarea is 18 rows tall and fills most of
 * the card, so it shows as much of a picture as a page background does — the
 * reason a narrow strip needs a stronger default doesn't apply here.
 *
 * This is what a library picture's own opacity would most often have been, so
 * the default keeps the look the picker had before the slider existed.
 */
export const DEFAULT_JOURNAL_CONTENT_TEXTURE_OPACITY = 0.1;

/**
 * What `content_texture_id` holds when no picture is chosen.
 *
 * `"0"` and not `""`, for the reason `NO_NAV_TEXTURE` documents: module-setting
 * values must be non-empty, so the screen cannot clear the choice by writing a
 * blank through the same path every other preference uses. Library ids are
 * AUTOINCREMENT rowids and start at 1, so this sentinel can never collide with
 * a real picture.
 */
export const NO_JOURNAL_CONTENT_TEXTURE = "0";

/** The one shape `<input type="color">` emits and the only one we store. */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * Clamp a stored strength to 0..1, falling back to the default.
 *
 * Module-setting values are free-form text with no CHECK behind them, so this
 * is the only thing between a hand-edited row and a Content field drawn at
 * opacity 40. A blank, a word and a number out of range all resolve to the
 * default rather than erroring — a bad preference should not break the form
 * you write entries in. Same contract as `resolveNavTextureOpacity`.
 */
export function resolveJournalContentTextureOpacity(value?: string): number {
  if (value === undefined || value.trim() === "") {
    return DEFAULT_JOURNAL_CONTENT_TEXTURE_OPACITY;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_JOURNAL_CONTENT_TEXTURE_OPACITY;
  return Math.min(1, Math.max(0, parsed));
}

const DEFAULT_TEMPERATURE_UNIT: JournalTemperatureUnit = "fahrenheit";

/** 20px — the `font-script` floor, and what the field used before it was configurable. */
const DEFAULT_HANDWRITING_SIZE: JournalHandwritingSize = "xl";

/**
 * The offered handwriting sizes, in order: what to store, what to call it, and the
 * Tailwind class that draws it.
 *
 * One table so the Preferences dropdown and the Content field read the same list —
 * a second copy is how a select ends up offering a size nothing renders. `label`
 * is named rather than numeric because this is a reading-comfort choice, not a
 * typographic one.
 *
 * Every `className` here is a literal that appears in the source, so Tailwind's
 * scanner emits all four. Don't rewrite these as interpolations.
 */
export const HANDWRITING_SIZE_OPTIONS: readonly {
  value: JournalHandwritingSize;
  label: string;
  className: string;
  px: number;
}[] = [
  { value: "xl", label: "Small", className: "text-xl", px: 20 },
  { value: "2xl", label: "Medium", className: "text-2xl", px: 24 },
  { value: "3xl", label: "Large", className: "text-3xl", px: 30 },
  { value: "4xl", label: "X-Large", className: "text-4xl", px: 36 },
];

/**
 * The Tailwind class for a stored size, falling back to the default for anything
 * unrecognised — so a hand-edited settings row can't leave the field with no size
 * class at all.
 */
export function handwritingSizeClass(size: JournalHandwritingSize): string {
  const match = HANDWRITING_SIZE_OPTIONS.find((option) => option.value === size);
  return (match ?? HANDWRITING_SIZE_OPTIONS[0]).className;
}

/**
 * Parses the journal module's key/value settings rows into typed preferences.
 * A default location is only reported when both coordinates parse as finite
 * numbers. Mirrors resolveThresholds for the Stocks module.
 */
export function resolveJournalPreferences(settings: ModuleSetting[]): JournalPreferences {
  const byKey = new Map(settings.map((setting) => [setting.key, setting.value]));

  const latitude = Number(byKey.get(JOURNAL_SETTING_KEYS.defaultLatitude));
  const longitude = Number(byKey.get(JOURNAL_SETTING_KEYS.defaultLongitude));
  const hasCoordinates =
    byKey.has(JOURNAL_SETTING_KEYS.defaultLatitude) &&
    byKey.has(JOURNAL_SETTING_KEYS.defaultLongitude) &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude);

  const defaultLocation = hasCoordinates
    ? { latitude, longitude, name: byKey.get(JOURNAL_SETTING_KEYS.defaultLocationName) ?? "" }
    : null;

  const temperatureUnit: JournalTemperatureUnit =
    byKey.get(JOURNAL_SETTING_KEYS.temperatureUnit) === "celsius" ? "celsius" : DEFAULT_TEMPERATURE_UNIT;

  // Trimmed: a stray space either side of a pasted path is invisible in the field but
  // would make the folder unreachable.
  const photoRoot = (byKey.get(JOURNAL_SETTING_KEYS.photoRoot) ?? "").trim();

  // Clamped against the offered list rather than cast, for the same reason the unit
  // above is: the stored value becomes a CSS class, and an unrecognised one (a hand-
  // edited row, a value from an older build) would render the field with no size at
  // all. Falling back keeps the 20px `font-script` floor a property of the read path.
  const storedSize = byKey.get(JOURNAL_SETTING_KEYS.handwritingSize);
  const handwritingSize =
    HANDWRITING_SIZE_OPTIONS.find((option) => option.value === storedSize)?.value ??
    DEFAULT_HANDWRITING_SIZE;

  // Only the exact string "true" reads as on. A boolean stored as text has no
  // shortage of ways to arrive wrong ("1", "yes", ""), and treating anything
  // non-empty as true would turn a hand-edited "false" row into a yes.
  const reviewBeforeCalendarImport =
    byKey.get(JOURNAL_SETTING_KEYS.reviewBeforeCalendarImport) === "true";

  // Comma-joined in one row rather than a row per word: the list is read and
  // written whole, and `parseExcludedWords` already tolerates the blanks,
  // casing and duplicates a hand-edited value could carry.
  const excludedWords = parseExcludedWords(byKey.get(JOURNAL_SETTING_KEYS.excludedWords) ?? "");

  // Only a whole number >= 1 is a real library id. `"0"` is the "no texture"
  // sentinel, and a blank, a word or a negative is what a hand-edited row looks
  // like — all of them mean "draw the plain sheet" rather than erroring. Note
  // this does NOT check the picture still exists: that needs the library, which
  // this function doesn't take. `resolveJournalContentTexture` does it.
  const storedTextureId = Number(byKey.get(JOURNAL_SETTING_KEYS.contentTextureId));
  const contentTextureId =
    Number.isInteger(storedTextureId) && storedTextureId >= 1 ? storedTextureId : null;

  // Validated rather than cast, for the same reason the handwriting size is:
  // the value reaches the DOM as a CSS color, and an unrecognised one would
  // either be ignored silently or — worse — be a value the browser does accept
  // but nobody chose. Only the exact `#RRGGBB` an `<input type="color">` emits
  // reads as set; anything else falls back to the theme's ink.
  const storedColor = (byKey.get(JOURNAL_SETTING_KEYS.contentTextColor) ?? "").trim();
  const contentTextColor = HEX_COLOR.test(storedColor) ? storedColor.toUpperCase() : null;

  // Always a number, never null: unlike the pointer and the colour there is no
  // "unset" state worth distinguishing — a texture always draws at *some*
  // strength, and the default is one of the legal values.
  const contentTextureOpacity = resolveJournalContentTextureOpacity(
    byKey.get(JOURNAL_SETTING_KEYS.contentTextureOpacity),
  );

  return {
    defaultLocation,
    temperatureUnit,
    photoRoot,
    handwritingSize,
    reviewBeforeCalendarImport,
    excludedWords,
    contentTextureId,
    contentTextureOpacity,
    contentTextColor,
  };
}

/**
 * The CSS the Content field draws its chosen picture with, or `undefined` for
 * the hand-drawn `.paper-texture` sheet.
 *
 * Separate from `resolveJournalPreferences` because it needs the texture
 * library, which the settings rows alone can't supply. Same split
 * `resolveNavTexture` keeps, and for the same reason: the preference is a
 * pointer, and only something holding the library can say whether it still
 * points at anything.
 *
 * Resolves to `undefined` for a stale pointer — an admin deleting a library
 * picture leaves this setting behind, and there is no foreign key to cascade.
 * Falling through to the plain sheet is what stops that from rendering as a
 * layer whose URL 404s: a Content field with no visible background at all,
 * rather than the one it had before the picture was deleted.
 *
 * The **journal's own** opacity is used, not the library row's — the same
 * divergence `resolveNavTexture` and `resolveToolbar` make. A library picture's
 * opacity was tuned for whatever surface it was last used on, and the Content
 * field is a surface you stare at while writing, so it gets its own knob rather
 * than inheriting one. The picture's mode and blur are not read at all: this
 * draws `bg-cover`, so a `tile` row would have nothing to say here.
 */
export function resolveJournalContentTexture(
  contentTextureId: number | null,
  textures: readonly DashboardTextureItem[],
  opacity: number = DEFAULT_JOURNAL_CONTENT_TEXTURE_OPACITY,
): { backgroundImage: string; opacity: number } | undefined {
  if (contentTextureId === null) return undefined;

  const picture = textures.find((texture) => texture.id === contentTextureId);
  if (!picture?.hasImage) return undefined;

  return {
    // `?v=<updatedAt>` because the serving route sends a 5-minute max-age —
    // without it, replacing the picture in the library would appear to do
    // nothing here. The same cache-buster the other resolvers build.
    backgroundImage: `url("/api/dashboard/texture?id=${picture.id}&v=${encodeURIComponent(
      picture.updatedAt,
    )}")`,
    // Clamped on the way out as well as on the way in, so a caller passing a
    // raw number (a slider mid-drag, a value from somewhere other than
    // `resolveJournalPreferences`) can't put an out-of-range opacity on screen.
    opacity: Math.min(1, Math.max(0, opacity)),
  };
}

/**
 * Serializes preferences into module-setting entries for saveModuleSettings.
 * Entry values must be non-empty (module-settings schema), so a blank location
 * name is omitted rather than stored as "".
 */
export function journalPreferencesToEntries(
  preferences: JournalPreferences,
): { key: string; value: string }[] {
  const entries: { key: string; value: string }[] = [
    { key: JOURNAL_SETTING_KEYS.temperatureUnit, value: preferences.temperatureUnit },
    // Always written, including at the default: the value is a closed set with no
    // "unset" member, so a row is never ambiguous the way a blank path would be.
    { key: JOURNAL_SETTING_KEYS.handwritingSize, value: preferences.handwritingSize },
    // Written at both values, including the `false` default: a missing row and a
    // stored "false" must mean the same thing, and only writing the true case
    // would make unticking the box a no-op.
    {
      key: JOURNAL_SETTING_KEYS.reviewBeforeCalendarImport,
      value: preferences.reviewBeforeCalendarImport ? "true" : "false",
    },
    // Always written, including the "none" case, as the sentinel rather than a
    // missing row — the same call `handwritingSize` and
    // `reviewBeforeCalendarImport` make just above.
    //
    // Clearing would survive either way: this screen saves through
    // `saveModuleSettings`, which replaces a module's rows wholesale, so an
    // omitted key is deleted rather than left behind. The sentinel is here
    // because an explicit "no texture" and a never-configured journal should
    // not be the same row state — a stored `"0"` is a choice somebody made,
    // and keeping it visible in the settings table is worth one row.
    {
      key: JOURNAL_SETTING_KEYS.contentTextureId,
      value:
        preferences.contentTextureId === null
          ? NO_JOURNAL_CONTENT_TEXTURE
          : String(preferences.contentTextureId),
    },
    // Always written, like the size and the review flag: the value has no
    // "unset" member, so a row is never ambiguous. Clamped here as well as on
    // read, so the stored value is always one the resolver would accept.
    {
      key: JOURNAL_SETTING_KEYS.contentTextureOpacity,
      value: String(Math.min(1, Math.max(0, preferences.contentTextureOpacity))),
    },
  ];

  // Omitted when unset rather than stored as "": the schema requires a
  // non-empty value, and an absent row is what "use the theme's ink" means on
  // read — the same shape `photoRoot` and `excludedWords` use below.
  //
  // No sentinel here, unlike the texture above, because an unset color already
  // has a name: the theme's own `--ink`. There is nothing for a reader to
  // distinguish between "never picked a color" and "deliberately chose the
  // theme's", since both render identically and both follow a theme switch.
  if (preferences.contentTextColor !== null) {
    entries.push({
      key: JOURNAL_SETTING_KEYS.contentTextColor,
      value: preferences.contentTextColor,
    });
  }

  // Omitted when blank rather than stored as "": moduleSettingEntrySchema requires a
  // non-empty value, and an absent row is what "not configured" means on read.
  if (preferences.photoRoot.trim() !== "") {
    entries.push({ key: JOURNAL_SETTING_KEYS.photoRoot, value: preferences.photoRoot.trim() });
  }

  if (preferences.defaultLocation) {
    entries.push(
      { key: JOURNAL_SETTING_KEYS.defaultLatitude, value: String(preferences.defaultLocation.latitude) },
      { key: JOURNAL_SETTING_KEYS.defaultLongitude, value: String(preferences.defaultLocation.longitude) },
    );
    if (preferences.defaultLocation.name.trim() !== "") {
      entries.push({
        key: JOURNAL_SETTING_KEYS.defaultLocationName,
        value: preferences.defaultLocation.name,
      });
    }
  }

  // Omitted when empty for the same reason as photoRoot: the schema rejects a
  // blank value, so "nothing excluded" has to be an absent row.
  const excluded = serializeExcludedWords(preferences.excludedWords);
  if (excluded !== "") {
    entries.push({ key: JOURNAL_SETTING_KEYS.excludedWords, value: excluded });
  }

  return entries;
}
