import type { FavPhoto } from "./types";

/**
 * Storage for favourited photographs.
 *
 * Keyed by relative path throughout — there is no surrogate id, so every method takes
 * the path that identifies the row. Both writes are idempotent, which is what lets the
 * toggle be a single statement rather than a read-then-write transaction.
 */
export interface FavPhotoRepository {
  /** Every favourite, newest first — the order the list reads in. */
  list(): FavPhoto[];
  /** One favourite, or `undefined` when the photo isn't starred. */
  get(relativePath: string): FavPhoto | undefined;
  isFavorite(relativePath: string): boolean;
  /**
   * Stars a photo. Idempotent: starring an already-starred photo is not an error,
   * and must not overwrite an existing note or move the row's `createdAt`.
   */
  add(relativePath: string, note: string): void;
  /** Idempotent: removing one that isn't there is not an error. */
  remove(relativePath: string): void;
  /**
   * Rewrites the note on an existing favourite.
   *
   * A no-op when the photo isn't starred — this must not resurrect a favourite that
   * was removed in another tab while its note was being edited.
   */
  setNote(relativePath: string, note: string): void;
}
