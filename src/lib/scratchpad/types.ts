/**
 * The Floating Scratchpad's domain types.
 *
 * All plain data. Nothing here knows about a window, a tab strip, a textarea or a
 * database — which is what lets the whole scratchpad be driven from a terminal and
 * tested without a browser.
 *
 * The one structural fact worth reading first: **a category is shared and a note is
 * not.** Categories are the tabs, configured once for the household in Administration;
 * notes are private working-out, owned by whoever typed them. That is why
 * `NoteCategory` carries no owner and `Note` does (migration 0096 explains the call).
 */

/**
 * One tab in the scratchpad: a category of notes.
 *
 * Household-wide, so there is deliberately no `userId` here. The admin arranges these;
 * everyone sees the same strip and files their own notes into it.
 */
export interface NoteCategory {
  id: number;
  /** The tab label, e.g. "Shopping". Unique case-insensitively. */
  name: string;
  /**
   * Position in the strip, left to right.
   *
   * Exposed rather than hidden because the admin screen reorders by it. Ties fall back
   * to insertion order — the repository sorts by `(sortOrder, id)`, so a tie is stable
   * rather than arbitrary.
   */
  sortOrder: number;
  /** ISO 8601, from the database. */
  createdAt: string;
}

/**
 * One note: someone's text, filed under one category.
 *
 * `title` is optional in spirit but always a string here — blank rather than absent, the
 * same mapping the database uses, so no caller has to handle two kinds of nothing. Use
 * `noteLabel` to get the string a list should actually show.
 */
export interface Note {
  id: number;
  /** Whose note this is. Part of every query's identity; never supplied by a client. */
  userId: number;
  categoryId: number;
  /** The reader's own label, or `""` when they never set one. */
  title: string;
  /** The note. `""` for a note that has been created but not yet typed into. */
  body: string;
  /** ISO 8601, from the database. */
  createdAt: string;
  /** ISO 8601. Bumped on every autosave, and what the list is ordered by. */
  updatedAt: string;
}

/**
 * Everything one reader needs to draw the window in one object.
 *
 * A snapshot rather than two separate fetches, because the window is useless with half
 * of it: the tab strip needs the categories and the open tab needs its notes, and the
 * layout resolves both in the same server pass. It also gives the CLI a single call
 * that prints the same thing the window shows.
 */
export interface ScratchpadSnapshot {
  /** Every category, in the admin's order. Empty when an admin has deleted them all. */
  categories: NoteCategory[];
  /**
   * This reader's notes in the **active** category, most recently edited first.
   *
   * Only one category's notes, not all of them. A household that has been using this
   * for a year has a lot of notes, and the window shows one tab at a time — loading
   * every tab's contents to render one of them is the kind of waste that only shows up
   * on a NAS over wifi.
   */
  notes: Note[];
  /**
   * Which category `notes` belongs to, or `undefined` when there are no categories at
   * all.
   *
   * Resolved server-side rather than left to the client to guess, so the first paint
   * has the right tab selected instead of flipping to it after hydration.
   */
  activeCategoryId?: number;
}

/**
 * Why a category could not be deleted.
 *
 * A closed union rather than a free-text message, so the admin screen decides how to
 * present each case and a test can assert which happened.
 */
export type CategoryDeleteRefusal =
  /** The id doesn't name a category — already deleted, or never existed. */
  | { kind: "not-found" }
  /**
   * Notes are still filed under it. Carries the counts so the screen can say *why*
   * without the admin having to go looking.
   *
   * Counts only. **No note text and no usernames** — this exists to explain a refusal,
   * not to show an admin other people's notebooks.
   */
  | { kind: "not-empty"; noteCount: number; ownerCount: number };

/**
 * The result of attempting to delete a category.
 *
 * A discriminated union rather than a thrown exception, for the reason
 * `EvaluationResult` gives: "that tab still has notes in it" is a routine, expected
 * outcome the screen has to render, not an exceptional condition. Making it a return
 * value means the caller cannot forget to handle it.
 */
export type CategoryDeleteResult =
  | { ok: true }
  | { ok: false; refusal: CategoryDeleteRefusal };

/**
 * A note rendered as a text file: what to call it, and what goes in it.
 *
 * `lib` returns both rather than the browser deciding, because "what should this file be
 * called" is a rule about notes (the title, or the first line, or a date) and would
 * otherwise be logic living in a `.tsx`. The CLI writes the identical file.
 */
export interface NoteTextFile {
  /** A safe, dated filename, e.g. `scratchpad-shopping-holiday-plan.txt`. */
  fileName: string;
  /** The file's full contents, including the small header. */
  content: string;
}
