/** One stored preference row. The owner is part of the identity, not the key alone. */
export interface UserPreference {
  id: number;
  userId: number;
  key: string;
  value: string;
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
}
