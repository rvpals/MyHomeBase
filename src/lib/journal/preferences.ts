import type { DashboardTextureItem, DashboardTextureMode } from "@/lib/dashboard-texture";
import type { ModuleSetting } from "@/lib/module-settings";
// The seven theme faces, as a value as well as a type: the Content font is
// validated against this list on read, so a stale or hand-edited key falls back
// to the theme rather than emitting a font-family that resolves to nothing.
import { FONT_KEYS, type FontKey } from "@/lib/settings/themes";
import type {
  JournalContentSize,
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
  topicMatchBody: "topic_match_body",
  topicEpisodeGapDays: "topic_episode_gap_days",
  excludedWords: "excluded_words",
  topWordLimit: "top_word_limit",
  contentTextureId: "content_texture_id",
  contentTextureOpacity: "content_texture_opacity",
  contentTextColor: "content_text_color",
  contentFont: "content_font",
  contentFontSize: "content_font_size",
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
 * Days of silence before the Topics timeline starts a new episode, when the
 * reader has not set one.
 *
 * Fourteen: long enough that a fortnight of quiet reads as "that was a separate
 * occasion", short enough that a weekly recurring thing stays in one run.
 *
 * These three mirror the bounds documented in `@/lib/journal-topics/episodes`.
 * They are restated rather than imported because that module imports this
 * one's types, and importing back would make the pair mutually dependent for
 * three numbers. `preferences.test.ts` pins them to the same values.
 */
export const DEFAULT_TOPIC_EPISODE_GAP_DAYS = 14;
/** A gap of 0 would make every entry its own episode — the timeline switched off. */
export const MIN_TOPIC_EPISODE_GAP_DAYS = 1;
export const MAX_TOPIC_EPISODE_GAP_DAYS = 365;

/**
 * How many words the home screen's Top Words card ranks when nobody has set a
 * number.
 *
 * Ten, because that is what the card showed for its whole life as the fixed
 * "Top 10 Words" — making the setting configurable shouldn't change what an
 * existing journal looks like on the next render.
 */
export const DEFAULT_TOP_WORD_LIMIT = 10;
/** A limit of 0 would render an empty card that looks broken rather than configured. */
export const MIN_TOP_WORD_LIMIT = 1;
/**
 * The ceiling is about reading, not cost: `topWords` tokenizes every entry's
 * text whatever the limit, so a hundred rows costs the same scan as ten and
 * only changes the final slice. A hundred is simply well past the point a
 * ranked list stops summarising anything.
 */
export const MAX_TOP_WORD_LIMIT = 100;

/**
 * Forces any number into a storable word limit: whole, 1..100, default for
 * anything that isn't a finite number at all.
 *
 * Exported so the Preferences screen clamps with *this* rather than with its
 * own copy of the bounds — the episode-gap field above repeats `1` and `365` at
 * its call site, and a second copy of a bound is how a form ends up saving a
 * value the resolver silently rejects on the way back in.
 *
 * `Math.trunc` rather than `Math.round`, so a stray `10.9` reads as the ten the
 * typist had before the keystroke rather than jumping to eleven.
 */
export function clampTopWordLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TOP_WORD_LIMIT;
  return Math.min(Math.max(Math.trunc(value), MIN_TOP_WORD_LIMIT), MAX_TOP_WORD_LIMIT);
}

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

/** 14px — `text-sm`, what every other field on the entry form uses. */
const DEFAULT_CONTENT_SIZE: JournalContentSize = "sm";

/**
 * The sizes the Content field offers with Handwriting **off**.
 *
 * A separate table from `HANDWRITING_SIZE_OPTIONS` rather than a shared one,
 * because the two surfaces want different ranges: cursive starts at the 20px
 * script floor design.md sets, while this is ordinary body text in a form and
 * starts at the 14px every sibling field uses. They overlap only at 20px.
 *
 * `label` is named rather than numeric for the same reason the handwriting
 * table's is — this is a reading-comfort choice, not a typographic one — but
 * the px is shown beside it, since a writer picking a size for a form field
 * reasonably wants to know what they are getting.
 *
 * Every `className` is a literal that appears in the source, so Tailwind's
 * scanner emits all five. Don't rewrite these as interpolations.
 */
export const CONTENT_SIZE_OPTIONS: readonly {
  value: JournalContentSize;
  label: string;
  className: string;
  px: number;
}[] = [
  { value: "sm", label: "Small", className: "text-sm", px: 14 },
  { value: "base", label: "Medium", className: "text-base", px: 16 },
  { value: "lg", label: "Large", className: "text-lg", px: 18 },
  { value: "xl", label: "X-Large", className: "text-xl", px: 20 },
  { value: "2xl", label: "XX-Large", className: "text-2xl", px: 24 },
];

/**
 * The Tailwind class for a stored Content size, falling back to the default for
 * anything unrecognised — so a hand-edited row can't leave the field with no
 * size class at all. Same contract as `handwritingSizeClass`.
 */
export function contentSizeClass(size: JournalContentSize): string {
  const match = CONTENT_SIZE_OPTIONS.find((option) => option.value === size);
  return (match ?? CONTENT_SIZE_OPTIONS[0]).className;
}

/**
 * The next size up the scale, or the same size at the top.
 *
 * Exists for the fullscreen Content stage, which has always drawn the plain
 * field one step larger than the card does — a sheet centred on a black stage
 * carries a bigger size comfortably, and before this was configurable the two
 * were hardcoded `text-base` and `text-sm`. Keeping the step means the reader's
 * choice sets the card and the stage stays proportional, rather than the stage
 * silently losing the bump the moment the preference shipped.
 *
 * Saturates rather than wrapping: at `2xl` there is nothing above to step to,
 * and wrapping to `sm` would make the stage *smaller* than the card.
 */
export function nextContentSizeUp(size: JournalContentSize): JournalContentSize {
  const index = CONTENT_SIZE_OPTIONS.findIndex((option) => option.value === size);
  if (index < 0) return DEFAULT_CONTENT_SIZE;
  return CONTENT_SIZE_OPTIONS[Math.min(index + 1, CONTENT_SIZE_OPTIONS.length - 1)].value;
}

/**
 * The CSS `font-family` for a stored Content face, or `undefined` to leave the
 * field on the theme's body font.
 *
 * Returns a `var(--font-…)` reference rather than a family name: all seven
 * faces are already declared on every page by `layout.tsx`'s `localFont`
 * loaders, and those variables are the seam. Naming a family directly here
 * would duplicate what the loaders own and break the moment one is swapped.
 *
 * `undefined` for an unrecognised key as well as for `null`, so a row written
 * by a build that offered a face this one doesn't falls back to the theme
 * rather than emitting a `font-family` that resolves to nothing.
 */
export function contentFontFamily(font: FontKey | null): string | undefined {
  if (font === null) return undefined;
  return FONT_KEYS.includes(font) ? `var(--font-${font})` : undefined;
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

  // Same strict "true" test, for the same reason.
  const topicMatchBody = byKey.get(JOURNAL_SETTING_KEYS.topicMatchBody) === "true";

  // Clamped rather than trusted, like the texture opacity above: the stored
  // value is text, and an absent row or a hand-edited "0" must not become a
  // one-day gap that gives every entry its own episode.
  //
  // Clamped here rather than by `clampEpisodeGapDays` in `@/lib/journal-topics`,
  // which holds the same bounds: that module imports this one's types, so
  // reaching back into it would make the two mutually dependent. The bounds are
  // stated once there and enforced once here, and `preferences.test.ts` pins
  // this copy to the same numbers.
  const rawGap = byKey.get(JOURNAL_SETTING_KEYS.topicEpisodeGapDays) ?? "";
  const storedGap = Number(rawGap);
  // `Number("")` is 0 -- an integer, and in range once clamped -- so a blank or
  // missing row would otherwise read as a one-day gap rather than as "unset".
  const topicEpisodeGapDays =
    rawGap.trim() !== "" && Number.isInteger(storedGap)
      ? Math.min(Math.max(storedGap, MIN_TOPIC_EPISODE_GAP_DAYS), MAX_TOPIC_EPISODE_GAP_DAYS)
      : DEFAULT_TOPIC_EPISODE_GAP_DAYS;

  // Comma-joined in one row rather than a row per word: the list is read and
  // written whole, and `parseExcludedWords` already tolerates the blanks,
  // casing and duplicates a hand-edited value could carry.
  const excludedWords = parseExcludedWords(byKey.get(JOURNAL_SETTING_KEYS.excludedWords) ?? "");

  // Clamped rather than trusted, exactly like the episode gap above and for the
  // same reason: `Number("")` is 0, an integer that clamps into range, so a
  // blank or missing row would otherwise read as a one-word list rather than as
  // "unset". The blank test has to come before the integer test, not after.
  const rawWordLimit = byKey.get(JOURNAL_SETTING_KEYS.topWordLimit) ?? "";
  const storedWordLimit = Number(rawWordLimit);
  const topWordLimit =
    rawWordLimit.trim() !== "" && Number.isInteger(storedWordLimit)
      ? Math.min(Math.max(storedWordLimit, MIN_TOP_WORD_LIMIT), MAX_TOP_WORD_LIMIT)
      : DEFAULT_TOP_WORD_LIMIT;

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

  // Validated against the loaded faces rather than cast: the value becomes a
  // CSS variable reference, and one naming a face this build doesn't load
  // would render the browser fallback — which looks like a bug, not a setting.
  // An absent or unrecognised row means "follow the theme's body font".
  const storedFont = byKey.get(JOURNAL_SETTING_KEYS.contentFont);
  const contentFont = FONT_KEYS.find((key) => key === storedFont) ?? null;

  // Clamped against the offered list for the same reason the handwriting size
  // is: the stored value becomes a Tailwind class, and an unrecognised one
  // would leave the field with no size class at all.
  const storedContentSize = byKey.get(JOURNAL_SETTING_KEYS.contentFontSize);
  const contentFontSize =
    CONTENT_SIZE_OPTIONS.find((option) => option.value === storedContentSize)?.value ??
    DEFAULT_CONTENT_SIZE;

  return {
    defaultLocation,
    temperatureUnit,
    photoRoot,
    topicMatchBody,
    topicEpisodeGapDays,
    handwritingSize,
    reviewBeforeCalendarImport,
    excludedWords,
    topWordLimit,
    contentTextureId,
    contentTextureOpacity,
    contentTextColor,
    contentFont,
    contentFontSize,
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
 * than inheriting one.
 *
 * The picture's **own** `mode` is honoured, though — unlike the opacity, and
 * deliberately so. Opacity is surface-dependent (a strength tuned for a
 * dashboard really is wrong behind a paragraph you are writing), but a seamless
 * pattern is seamless everywhere: a picture marked `tile` is one meant to
 * repeat at its natural size, and stretching it here would be drawing it wrong
 * rather than drawing it differently. This is what `resolveAppTexture` does for
 * page backgrounds too; only the navigation and the personal toolbars override
 * the mode, because a 260px column is too narrow to show a stretched picture at
 * all.
 *
 * `blur` is still not read: it is applied by a filter on the page-background
 * rule, and the Content field's layer has no equivalent.
 */
export function resolveJournalContentTexture(
  contentTextureId: number | null,
  textures: readonly DashboardTextureItem[],
  opacity: number = DEFAULT_JOURNAL_CONTENT_TEXTURE_OPACITY,
): { backgroundImage: string; opacity: number; mode: DashboardTextureMode } | undefined {
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
    // The library row's own, straight through. The repository already narrows
    // anything unrecognised to `cover`, so there is nothing to clamp here.
    mode: picture.mode,
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
    // Both Topics settings follow the same rule as the row above: written at
    // every value, so unticking the box or restoring the default gap is a real
    // change rather than a no-op that leaves the old row in place.
    {
      key: JOURNAL_SETTING_KEYS.topicMatchBody,
      value: preferences.topicMatchBody ? "true" : "false",
    },
    {
      key: JOURNAL_SETTING_KEYS.topicEpisodeGapDays,
      value: String(preferences.topicEpisodeGapDays),
    },
    // Always written, at the default as well, for the reason the gap above is:
    // this save replaces the module's rows wholesale, so only writing a
    // non-default would make "put it back to 10" a no-op that leaves the old
    // row standing. Clamped here as well as on read, so the stored value is
    // always one the resolver would accept back unchanged.
    {
      key: JOURNAL_SETTING_KEYS.topWordLimit,
      value: String(clampTopWordLimit(preferences.topWordLimit)),
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
    // Always written, like the handwriting size: every value in the set is a
    // legal size and there is no "unset" member, so a row is never ambiguous.
    { key: JOURNAL_SETTING_KEYS.contentFontSize, value: preferences.contentFontSize },
  ];

  // Omitted when unset rather than stored as "": the schema rejects a blank
  // value, and an absent row is what "follow the theme's body font" means on
  // read. The same shape the text colour uses, and for the same reason — an
  // unset face already has a name, so there is nothing a sentinel would add.
  if (preferences.contentFont !== null) {
    entries.push({ key: JOURNAL_SETTING_KEYS.contentFont, value: preferences.contentFont });
  }

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
