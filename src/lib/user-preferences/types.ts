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
}
