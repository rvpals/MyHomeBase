import type { PhotoRootCheck } from "./types";

/**
 * Read-only access to the photo archive.
 *
 * THE ENTIRE INTERFACE IS READ-ONLY, AND MUST STAY THAT WAY. There is no write,
 * create, move, rename, delete or set-times method here, and none may be added. These
 * are the household's only copies of these photographs; this module's job is to *find*
 * them for a journal entry, not to manage them. A bug in the app cannot damage a photo
 * because there is no code path from the app to a write -- the capability does not
 * exist in the type. Same rule, and the same reasoning, as `MusicFileStore`.
 *
 * Consequences that follow and are deliberate:
 *
 * - Nothing is written into a photo folder -- not a thumbnail cache, not an index,
 *   not a sidecar. Thumbnails are the original JPEGs scaled by the browser.
 * - No EXIF is ever rewritten, even when a date looks wrong.
 * - A folder that has moved or been renamed simply stops matching. Nothing is
 *   "repaired" on disk.
 *
 * If a future feature genuinely needs a write (a real thumbnail cache is the likely
 * one), it needs a separate, explicitly named port and a migration-log entry
 * justifying it -- not a method here. A cache should live outside the archive anyway.
 */
export interface PhotoFileStore {
  /** Whether the configured photo root exists and is readable. */
  isRootAvailable(): Promise<boolean>;

  /**
   * The same question with the reason attached — unset, missing, not permitted, or
   * unreachable.
   *
   * Worth a second method because the four cases need four different fixes, and a
   * boolean sent everyone to the same unhelpful "isn't configured or can't be reached"
   * message. Especially on a Synology, where a shared folder the app cannot read looks
   * exactly like one that does not exist.
   */
  checkRoot(): Promise<PhotoRootCheck>;

  /** Whether one relative folder exists -- used to check for the year folder. */
  folderExists(relativeFolder: string): Promise<boolean>;

  /**
   * The immediate sub-folder names of a relative folder. One level only: matching
   * happens on the year folder's direct children, so walking deeper would read the
   * whole archive to answer a question about one date.
   */
  listFolderNames(relativeFolder: string): Promise<string[]>;

  /**
   * The `.jpg`/`.jpeg` file names directly inside a relative folder, sorted.
   *
   * Names only, not paths, and no recursion -- the two folder conventions are both
   * flat. Filtering to photos happens here so a folder of mixed RAW and JPEG does not
   * ship hundreds of irrelevant names to the caller.
   */
  listPhotoNames(relativeFolder: string): Promise<string[]>;

  /**
   * The first `byteCount` bytes of a file, for the EXIF reader.
   *
   * A partial read, not the whole file: this is called once per photo in a month
   * folder, and reading complete multi-megabyte files over SMB is the difference
   * between a scan that takes a second and one that takes minutes. Returns
   * `undefined` when the file cannot be read at all -- a permissions problem on one
   * photo must not fail the folder.
   */
  readHeader(relativePath: string, byteCount: number): Promise<Uint8Array | undefined>;

  /** One photo's bytes and MIME type, for the route that serves it to the browser. */
  readPhoto(relativePath: string): Promise<{ data: Uint8Array; mimeType: string } | undefined>;

  /**
   * One photo's size in bytes and modification time, without reading its contents.
   *
   * Added for the Magic List indexer (`migrations/0093`), which filters on file size and
   * needs a cheap way to tell whether a cached row is still valid. An unchanged size and
   * mtime mean the file has not changed, so neither the header read nor the re-index is
   * repeated -- the skip that makes a re-scan take seconds instead of minutes.
   *
   * STILL READ-ONLY, and deliberately so. This is an OBSERVATION: it adds no write,
   * create, move, rename, delete or set-times capability, so the property this whole
   * interface exists to guarantee is intact -- there is no code path from the app to a
   * modification of a photograph, and the type system still makes one impossible. `stat`
   * is already what `checkRoot`, `folderExists` and `readPhoto` call; this exposes the
   * two fields the indexer needs rather than adding a new kind of access.
   *
   * `mtime` is ISO 8601, matching `mus_tracks.file_mtime` -- a string so the cached
   * comparison is an exact equality rather than a float that can drift across
   * filesystems. Returns `undefined` when the file cannot be read at all, so one
   * unreadable photo is skipped rather than failing the scan it appears in.
   */
  statPhoto(relativePath: string): Promise<{ bytes: number; mtime: string } | undefined>;
}
