/**
 * A photo album: a named, ordered set of paths into the photo archive.
 *
 * The first thing the Picture Gallery module owns. Everything else it shows belongs to
 * another module — the archive is the Journal's folder read through `journal-photos`,
 * the kept pictures are `fav-photos` — and an album is the one concept that is genuinely
 * this module's own, which is why it gets a table and a prefix where the module had
 * neither.
 *
 * Like a favourite, an album stores PATHS, never bytes or copies. A picture can be in
 * any number of albums and in none, and putting it in one neither moves nor duplicates
 * the file on the NAS. See `migrations/0087_create_albums.md`.
 */
export interface Album {
  id: number;
  /** What the reader called it. Unique, trimmed, never blank. */
  name: string;
  /** Free text. `""` when nothing was written — never null, per `coding-guide.md`. */
  description: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * One photograph's membership in one album.
 *
 * `sortOrder` is the album's own sequence, which is the point of an album as against a
 * folder: the reader arranges these for a slideshow, so the order is data rather than
 * something derived from a file name or a capture date.
 */
export interface AlbumPhoto {
  /** Path from the photo root, e.g. `2019/2019-06 June/IMG_20190609_143501.jpg`. */
  relativePath: string;
  /** Position within the album, ascending. Contiguous from 0 after any write. */
  sortOrder: number;
  /** When it was added to this album, ISO-ish (`datetime('now')`). */
  addedAt: string;
}

/**
 * An album plus a count, for the list screen.
 *
 * The count comes from SQL rather than from loading the photos and measuring, because
 * the list shows every album at once and reading a thousand membership rows to print
 * six numbers is work nobody asked for.
 */
export interface AlbumSummary extends Album {
  photoCount: number;
  /**
   * The first photo's path, for the list's cover thumbnail — `undefined` when empty.
   *
   * The FIRST by `sortOrder`, not a random one, so an album's tile looks the same on
   * every visit and the reader can choose what it shows by reordering.
   */
  coverPath?: string;
}

/** One album with its photographs in order — what the detail screen reads. */
export interface AlbumWithPhotos extends Album {
  photos: AlbumPhoto[];
}
