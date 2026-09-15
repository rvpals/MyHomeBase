import type { TemperatureUnit } from "@/lib/weather";

/** One stored preference row. The owner is part of the identity, not the key alone. */
export interface UserPreference {
  id: number;
  userId: number;
  key: string;
  value: string;
}

/**
 * How the compact layout lays out navigation. See `nav-style.ts` for what each
 * one does and `design.md` for why both exist.
 *
 * A union rather than a boolean because a third arrangement is plausible, and a
 * `useSplitNavBar` flag would have to be renamed to add one.
 */
export type CompactNavStyle = "drill-in" | "segmented";

/**
 * Where a user wants their weather from.
 *
 * All three fields travel together or not at all — coordinates without a name would
 * give the card nothing to label itself with, and a name without coordinates cannot be
 * fetched. That is why this is one nullable object on `UserPreferences` rather than
 * three independent optional fields: the invalid halfway states aren't representable.
 */
export interface WeatherLocation {
  latitude: number;
  longitude: number;
  /** What to show on the card, e.g. "London, England". */
  name: string;
}

/**
 * A user's preferences as a typed object, resolved from the key/value rows.
 * Every field has a defined value here — absence is expressed as `undefined`
 * (favorite) or `false` (the flag), never as a missing property, so callers
 * don't branch on whether a row existed.
 */
export interface UserPreferences {
  /** Module slug, or `undefined` when nothing is chosen. Never `""`. */
  favoriteModuleSlug?: string;
  /** Whether logging in should go straight to the favorite module. */
  openFavoriteModuleOnStartup: boolean;
  /**
   * The compact navigation arrangement. Always a known style — a missing or
   * unrecognised row resolves to the default rather than `undefined`, because
   * navigation has to render whatever is stored.
   */
  compactNavStyle: CompactNavStyle;
  /**
   * The place the home screen's Clock card forecasts for, or `undefined` when the
   * user hasn't set one — in which case the card shows the clock alone.
   */
  weatherLocation?: WeatherLocation;
  /** The unit the forecast is shown in. Always defined; defaults to Fahrenheit. */
  weatherUnit: TemperatureUnit;
}
