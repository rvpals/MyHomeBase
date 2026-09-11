import type { Album, AlbumPhoto, AlbumSummary, AlbumWithPhotos } from "./types";

/**
 * Storage for photo albums and their membership.
 *
 * Albums are keyed by a surrogate `id`, unlike favourites (keyed by path) — a name is
 * the reader's to change, so it cannot be the key, and there is nothing else about an
 * album that identifies it. Membership rows are addressed by `(albumId, relativePath)`,
 * which the unique index makes a real key.
 *
 * Every membership write is idempotent or explicitly reports what it did, so a
 * double-tap on "add to album" is never an error.
 */
export interface AlbumRepository {
  /** Every album with its photo count and cover, newest first. */
  listSummaries(): AlbumSummary[];
  /** One album without its photos — enough to rename, describe or check existence. */
  get(id: number): Album | undefined;
  /** One album with its photographs in `sortOrder`. */
  getWithPhotos(id: number): AlbumWithPhotos | undefined;
  /**
   * Whether an album already carries this name.
   *
   * `exceptId` lets a rename keep its own name — without it, saving an unchanged name
   * would collide with the row being renamed.
   */
  nameExists(name: string, exceptId?: number): boolean;
  /** Creates an album and returns it, `createdAt`/`updatedAt` set by the store. */
  create(name: string, description: string): Album;
  /** Renames and re-describes in one write, touching `updatedAt`. */
  update(id: number, name: string, description: string): void;
  /** Deletes the album; membership rows go with it via `ON DELETE CASCADE`. */
  remove(id: number): void;

  /** The photographs in one album, in `sortOrder`. */
  listPhotos(albumId: number): AlbumPhoto[];
  /**
   * Adds paths to the end of an album, skipping any already in it.
   *
   * Returns how many were actually inserted, which is what lets the caller say "3 of 5
   * added, 2 were already there" rather than claiming all five. Appends in the order
   * given, after the current highest `sortOrder`.
   */
  addPhotos(albumId: number, relativePaths: string[]): number;
  /** Removes paths from an album, returning how many rows actually went. */
  removePhotos(albumId: number, relativePaths: string[]): number;
  /**
   * Rewrites the album's order to exactly this sequence.
   *
   * The caller has already checked the set matches the album's membership, so this is
   * a straight renumber from 0 — it does not add or delete.
   */
  setPhotoOrder(albumId: number, relativePaths: string[]): void;
  /** Which of these albums already contain the photo — for the viewer's `+` menu. */
  albumIdsContaining(relativePath: string): number[];
}
