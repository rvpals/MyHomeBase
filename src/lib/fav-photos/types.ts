/**
 * A favourited photograph.
 *
 * Deliberately thin — the path, why it was kept, and when. Everything else about the
 * picture (its folder, its capture date, its bytes) is already derivable from the path
 * by the photo archive, so storing any of it here would be a second copy that can go
 * stale when a folder is reorganised.
 *
 * `relativePath` is from the configured photo root, not absolute; see
 * `migrations/0073_create_fav_photo.md` for why.
 */
export interface FavPhoto {
  /** Path from the photo root, e.g. `2019/2019-06 June/IMG_20190609_143501.jpg`. */
  relativePath: string;
  /** Why this one was kept. `""` when nothing was written — never null. */
  note: string;
  /** When it was starred, ISO-ish (`datetime('now')`). */
  createdAt: string;
}
