import type { Shortcut, ShortcutDraft } from "./types";

/**
 * What the shortcut use-cases need from storage.
 *
 * **Every method is scoped by `userId`**, without exception. A shortcut list is
 * a personal workspace, so the owner is part of every query's identity and
 * there is no method here that can read or write across users — the same
 * invariant `ScratchpadRepository` carries, and for the same reason.
 *
 * That invariant is what makes an id arriving from a client safe to act on: the
 * use-case passes the session's user id, and a row belonging to someone else
 * simply isn't found. No separate ownership check is needed at the call site,
 * because there is no call that could skip it.
 */
export interface UserShortcutsRepository {
  /** This person's shortcuts, ordered by `(sortOrder, id)` — the card's order. */
  list(userId: number): Shortcut[];

  /** One of this person's shortcuts, or `undefined` — including when it is someone else's. */
  findById(userId: number, id: number): Shortcut | undefined;

  /** How many this person has, for the cap. */
  count(userId: number): number;

  /**
   * Appends a shortcut at the end of this person's list and returns it as stored.
   *
   * The store decides `sortOrder` (one past the current last) rather than taking
   * it: a caller that picked its own position would race another tab into a
   * duplicate, and "new things go last" is not a decision worth exposing.
   */
  create(userId: number, draft: ShortcutDraft): Shortcut;

  /**
   * Overwrites one of this person's shortcuts with `draft`, returning it as stored.
   *
   * Takes the whole draft rather than a partial: the edit dialog always submits
   * every field, and a kind that changed from `url` to `section` must blank the
   * columns the old kind used. A partial update would leave a URL behind on a
   * row that is now a section shortcut — invisible, until someone read the row
   * directly and found two destinations on it.
   *
   * Returns `undefined` when the id isn't this person's, so the use-case
   * reports a miss rather than reporting success for a write that never landed.
   */
  update(userId: number, id: number, draft: ShortcutDraft): Shortcut | undefined;

  /** Deletes one. Returns whether a row was actually removed. */
  delete(userId: number, id: number): boolean;

  /**
   * Writes the given ids' positions to match their order in the array.
   *
   * Ids that aren't this person's are ignored rather than throwing — a stale
   * card posting a deleted id should not fail the reorder of the ones that
   * remain, and ignoring is also what keeps another user's id inert here.
   */
  reorder(userId: number, ids: readonly number[]): Shortcut[];

  /**
   * The uploaded icon's bytes, or `undefined` when there is none.
   *
   * **The only method that reads the BLOB**, which is what keeps the bytes out
   * of every home-screen render — every other read here names its columns and
   * omits them. Its one caller is the serving route.
   *
   * Scoped by `userId` like everything else, and here that scoping is
   * load-bearing rather than merely uniform: these pictures are private to
   * their owner, so the route depends on this returning nothing for someone
   * else's row. See the migration log.
   */
  getIcon(userId: number, id: number): { data: Buffer; mimeType: string } | undefined;

  /**
   * Stores an uploaded icon against one of this person's shortcuts.
   *
   * Returns whether a row was written, so the use-case can report a miss rather
   * than reporting success for an upload that went nowhere.
   */
  setIcon(userId: number, id: number, image: { data: Buffer; mimeType: string }): boolean;

  /**
   * Removes the uploaded icon, leaving the row's glyph to take over.
   *
   * Deliberately does not touch `icon`: that column is always populated, so
   * clearing the picture reveals the glyph underneath rather than leaving the
   * tile with nothing to draw.
   */
  clearIcon(userId: number, id: number): boolean;
}
