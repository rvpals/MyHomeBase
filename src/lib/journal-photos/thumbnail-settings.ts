// The switch for the thumbnail route's expensive half, and how a stored row becomes it.
//
// Pure: no I/O, no `deps`. The route reads the rows and calls `resolve...`, which is what
// makes "what does a blank row mean?" testable without a database. Modelled on
// `src/lib/backup/settings.ts`, with the same split -- resolution here, composition at the
// call site.
//
// An APP setting, not a module setting (migrations/0185): the route serves the Journal,
// Picture Gallery and the Random Photo card, so there is no one module to hang it off.

/**
 * The switch's key in `sys_app_settings`.
 *
 * Spelled here once. This string is a primary key in that table, so renaming it orphans
 * an administrator's stored choice -- the same rule as the icon slot ids.
 */
export const PHOTO_THUMBNAIL_SETTING_KEYS = {
  resizeOriginals: "photo_thumbnail_resize",
} as const;

/** On, because resizing is what ships; the switch exists to turn it off. See 0185. */
export const DEFAULT_RESIZE_ORIGINALS = true;

export interface PhotoThumbnailSettings {
  /**
   * Whether the server may shrink an ORIGINAL to make a thumbnail.
   *
   * Only reaches photos with no embedded EXIF preview -- the preview is always used when
   * there is one, and is 8.7x to 13.3x cheaper. With this off, a preview-less photo falls
   * back to its original as-is, which is what the strip served before 2026-11-17.
   */
  resizeOriginals: boolean;
}

/**
 * The stored rows as a typed switch.
 *
 * Degrades to **on** for a missing row, a blank one, or a hand-edited value that is
 * neither `true` nor `false`. Deliberately: this runs on an image request where a throw
 * would mean a broken tile, and "a row nobody has set" and "a row somebody typed `yes`
 * into" should both behave like the shipped default rather than silently disabling a
 * feature. Only an explicit `false` turns it off.
 */
export function resolvePhotoThumbnailSettings(
  rows: { key: string; value: string }[],
): PhotoThumbnailSettings {
  const stored = rows.find((row) => row.key === PHOTO_THUMBNAIL_SETTING_KEYS.resizeOriginals);
  const value = stored?.value.trim().toLowerCase();
  return { resizeOriginals: value === "false" ? false : DEFAULT_RESIZE_ORIGINALS };
}

/**
 * The stored encoding of the switch: `"true"` or `"false"`.
 *
 * Here rather than at the call site so the resolver above and the writer agree by
 * construction -- the same pairing as `systemLogBooleanValue`. Spelled out rather than
 * `"1"`/`"0"`, matching the other app settings (see migrations/0185).
 */
export function photoThumbnailResizeValue(enabled: boolean): string {
  return enabled ? "true" : "false";
}
