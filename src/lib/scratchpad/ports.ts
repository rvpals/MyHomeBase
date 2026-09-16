import type { Note, NoteCategory } from "./types";

/**
 * What the category use-cases need from storage.
 *
 * Two ports rather than one, split along the ownership line migration 0096 draws:
 * categories are household-wide and notes are per-person. Keeping them apart means a
 * use-case that only reads the tab strip cannot reach a note, and the admin screen's
 * repository has no method that could return anyone's text.
 */
export interface NoteCategoryRepository {
  /** Every category, ordered by `(sortOrder, id)` — the tab strip's order. */
  list(): NoteCategory[];
  /** One category, or `undefined`. The existence check the note use-cases need. */
  findById(id: number): NoteCategory | undefined;
  /**
   * Whether a name is taken, case-insensitively, ignoring `exceptId`.
   *
   * `exceptId` is what makes renaming a category to a different capitalisation of its
   * own name work ("work" → "Work") instead of colliding with itself.
   */
  isNameTaken(name: string, exceptId?: number): boolean;
  /** Appends a category at the end of the strip and returns it as stored. */
  create(name: string): NoteCategory;
  /** Renames one. Returns the stored row, or `undefined` if the id is gone. */
  rename(id: number, name: string): NoteCategory | undefined;
  /**
   * Writes the given ids' positions to match their order in the array.
   *
   * Takes the whole list so the strip can never be left half-reordered — see
   * `reorderCategoriesSchema`. Ids that no longer exist are ignored rather than
   * throwing, since a stale admin screen posting a deleted id should not fail the
   * reorder of the ones that remain.
   */
  reorder(ids: readonly number[]): NoteCategory[];
  /**
   * Deletes a category. The caller has already checked it is empty.
   *
   * Deliberately **not** cascading, and deliberately not checking emptiness itself: the
   * guard lives in `deleteCategory` where it can return a reason the screen renders,
   * and a repository that silently deleted notes would make that guard bypassable.
   */
  delete(id: number): void;
  /** How many categories exist, for the cap. */
  count(): number;
  /**
   * How many notes are filed under this category, and how many distinct people wrote
   * them — across **all** users.
   *
   * The one household-wide read in the module, and it returns nothing but numbers. It
   * exists solely so a refused delete can explain itself; there is no method here that
   * returns a note's text or an owner's name, so an admin screen cannot grow into a
   * window onto other people's notebooks.
   */
  countNotes(id: number): { noteCount: number; ownerCount: number };
}

/**
 * What the note use-cases need from storage.
 *
 * **Every method is scoped by `userId`.** A note is private working-out, so the owner is
 * part of every query's identity and there is no method that can read or write across
 * users. That is the invariant that makes an id arriving from a client safe to act on:
 * the use-case passes the session's user id, and a note belonging to someone else simply
 * isn't found.
 */
export interface ScratchpadRepository {
  /** This user's notes in one category, most recently edited first. */
  listByCategory(userId: number, categoryId: number): Note[];
  /** One of this user's notes, or `undefined` — including when it is someone else's. */
  findById(userId: number, id: number): Note | undefined;
  /** How many notes this user has in one category, for the cap. */
  countInCategory(userId: number, categoryId: number): number;
  /** Creates a note and returns it as stored. */
  create(userId: number, categoryId: number, title: string, body: string): Note;
  /**
   * Writes the given fields and bumps `updated_at`, returning the stored note.
   *
   * An omitted field is left alone rather than blanked — that is what lets autosave
   * write a body without touching a title the reader just set. `undefined` for both is
   * a valid call that only touches the timestamp.
   *
   * Returns `undefined` when the note isn't this user's, so the use-case reports a
   * miss rather than reporting success for a write that never happened.
   */
  update(
    userId: number,
    id: number,
    fields: { title?: string; body?: string },
  ): Note | undefined;
  /** Deletes one of this user's notes. Returns whether a row was actually removed. */
  delete(userId: number, id: number): boolean;
}
