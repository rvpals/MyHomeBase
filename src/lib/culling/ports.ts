import type { PhotoRootCheck } from "../journal-photos";

/**
 * Read-only access to a folder of images, for the culler.
 *
 * THE ENTIRE INTERFACE IS READ-ONLY, AND MUST STAY THAT WAY — the same rule, for the
 * same reason, as `PhotoFileStore`. There is no write, create, move, rename, delete or
 * set-times method here, and none may be added. Culling *ranks* photographs; it does
 * not act on the ranking. A bug in the scoring cannot delete a picture because the
 * capability does not exist in the type.
 *
 * In particular: this module never deletes a reject, never moves a keeper, and never
 * writes a sidecar, an index or a thumbnail into the archive. Its entire output is the
 * returned `CullResult`, plus an optional JSON file at a path the caller names — which
 * the CLI, not this module, is responsible for keeping outside the archive.
 *
 * ## Why not reuse `PhotoFileStore`
 *
 * That port reads the *head* of a file (`readHeader`) because the journal only needs
 * EXIF. Culling needs whole-file bytes to decode pixels, which is a genuinely different
 * and much more expensive kind of access. Widening `PhotoFileStore` with a whole-file
 * read would hand that cost to every caller that only wanted a date. A separate port
 * keeps the expensive capability where it is actually used.
 */
export interface CullingImageStore {
  /** Whether the configured root exists and is readable, and why not when it isn't. */
  checkRoot(): Promise<PhotoRootCheck>;

  /**
   * The decodable image file names directly inside a relative folder, sorted.
   *
   * Names only, no recursion — a culling run is about one folder. Filtering to
   * supported extensions happens in the store so a folder of mixed RAW and JPEG does
   * not ship hundreds of names that would only fail to decode.
   */
  listImageNames(relativeFolder: string): Promise<string[]>;

  /**
   * File names in the folder this module recognises but cannot decode — HEIC.
   *
   * Separate from `listImageNames` so the culler can report them as unreadable with an
   * accurate reason instead of leaving a reader to wonder why an iPhone folder came
   * back empty.
   */
  listUndecodableNames(relativeFolder: string): Promise<string[]>;

  /**
   * One image's full bytes, or `undefined` when it cannot be read.
   *
   * The whole file, unlike the journal's partial `readHeader` — pixels cannot be
   * decoded from a prefix. `undefined` rather than a throw so one unreadable file is
   * recorded and skipped instead of failing the folder.
   */
  readImage(relativePath: string): Promise<Uint8Array | undefined>;
}
