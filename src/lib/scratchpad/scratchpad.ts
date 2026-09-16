import type { NoteCategoryRepository, ScratchpadRepository } from "./ports";
import {
  NOTES_PER_CATEGORY_LIMIT,
  createNoteSchema,
  deleteNoteSchema,
  listNotesSchema,
  saveNoteSchema,
} from "./schema";
import type { Note, ScratchpadSnapshot } from "./types";

/**
 * What a list should call a note.
 *
 * The reader's title when they set one; otherwise the note's **first non-blank line**,
 * shortened. Computed on read rather than stored, because a stored copy would go stale
 * the moment the body was edited — and there is no query that needs it as a column
 * (migration 0096 records the call).
 *
 * "Untitled note" is the last resort for a note that has been created and not yet typed
 * into, which is exactly what "New note" produces. An empty string would collapse the
 * row in the list to nothing clickable.
 */
export function noteLabel(note: Pick<Note, "title" | "body">): string {
  const title = note.title.trim();
  if (title !== "") return title;

  // `split` on both newline forms: a note pasted from Windows carries `\r\n`, and
  // splitting on `\n` alone would leave a trailing `\r` that renders as a stray box.
  const firstLine = note.body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== "");

  if (firstLine === undefined || firstLine === "") return "Untitled note";
  // 60 characters is about a list row's worth. The ellipsis is a real character rather
  // than CSS truncation because the CLI prints this string too.
  return firstLine.length > 60 ? `${firstLine.slice(0, 59)}…` : firstLine;
}

/**
 * Which category a window should open on.
 *
 * The requested one when it exists, else the first in the strip, else nothing at all
 * (an admin has deleted every category). Resolved here rather than in the view so the
 * server's first paint has the right tab selected, and so the CLI makes the same choice.
 *
 * A requested id that no longer exists falls back rather than erroring: a reader whose
 * window remembered a tab an admin has since deleted should find the first tab, not a
 * broken window.
 */
export function resolveActiveCategoryId(
  categories: readonly { id: number }[],
  requested?: number,
): number | undefined {
  if (requested !== undefined && categories.some((category) => category.id === requested)) {
    return requested;
  }
  return categories[0]?.id;
}

/**
 * Everything one reader needs to draw the window.
 *
 * One use-case rather than two calls, because the window is useless with half of it —
 * and because this is the single function the layout, the server action and the CLI all
 * drive, so none of them can resolve the active tab differently.
 *
 * Only the active category's notes are read. A household that has used this for a year
 * has a lot of notes and the window shows one tab at a time; loading every tab to render
 * one is the kind of waste that only shows itself on a NAS over wifi.
 */
export function getScratchpad(
  categoryRepo: NoteCategoryRepository,
  noteRepo: ScratchpadRepository,
  userId: number,
  input: { categoryId?: number } = {},
): ScratchpadSnapshot {
  const { categoryId } = listNotesSchema.parse(input);
  const categories = categoryRepo.list();
  const activeCategoryId = resolveActiveCategoryId(categories, categoryId);

  return {
    categories,
    notes:
      activeCategoryId === undefined
        ? []
        : noteRepo.listByCategory(userId, activeCategoryId),
    activeCategoryId,
  };
}

/** This reader's notes in one category, most recently edited first. */
export function listNotes(
  noteRepo: ScratchpadRepository,
  userId: number,
  categoryId: number,
): Note[] {
  return noteRepo.listByCategory(userId, categoryId);
}

/**
 * Creates a note in a category.
 *
 * Two checks before the write, and both return a message rather than throwing, because
 * both are things a reader can actually cause:
 *
 * - **The category has to exist.** Otherwise a stale window could file a note under a
 *   deleted tab, where nothing would ever show it again.
 * - **The per-category cap.** Enforced by *refusing* rather than by pruning the oldest,
 *   unlike the calculator's tape: a tape is a rolling record where losing the oldest
 *   line is intended, but a note is something someone wrote deliberately and deleting
 *   it to make room would be data loss.
 */
export function createNote(
  categoryRepo: NoteCategoryRepository,
  noteRepo: ScratchpadRepository,
  userId: number,
  input: { categoryId: number; title?: string; body?: string },
): { ok: true; note: Note } | { ok: false; message: string } {
  const validated = createNoteSchema.parse(input);

  if (!categoryRepo.findById(validated.categoryId)) {
    return { ok: false, message: "That category no longer exists." };
  }

  if (noteRepo.countInCategory(userId, validated.categoryId) >= NOTES_PER_CATEGORY_LIMIT) {
    return {
      ok: false,
      message: `That category is full (${NOTES_PER_CATEGORY_LIMIT} notes). Delete one first.`,
    };
  }

  return {
    ok: true,
    note: noteRepo.create(userId, validated.categoryId, validated.title, validated.body),
  };
}

/**
 * Saves a note's title, body, or both — what autosave calls.
 *
 * Scoped to `userId` by the port, so a note id belonging to someone else is simply not
 * found. That is the whole defence here: the id crosses a boundary from a client, and
 * the session decides whose note it may touch.
 *
 * An omitted field is left alone rather than blanked, which is what lets a body autosave
 * run without clobbering a title the reader set a moment earlier.
 */
export function saveNote(
  noteRepo: ScratchpadRepository,
  userId: number,
  input: { id: number; title?: string; body?: string },
): { ok: true; note: Note } | { ok: false; message: string } {
  const validated = saveNoteSchema.parse(input);

  const saved = noteRepo.update(userId, validated.id, {
    title: validated.title,
    body: validated.body,
  });

  // A miss means the note was deleted (possibly in another tab) or was never this
  // reader's. Reported rather than silently succeeding, so an autosave into a deleted
  // note doesn't look like it worked.
  if (!saved) return { ok: false, message: "That note no longer exists." };

  return { ok: true, note: saved };
}

/**
 * Deletes one note.
 *
 * Scoped to the owner, like every other note operation. Returns a plain result rather
 * than throwing on a miss: deleting a note that has already gone is not an error worth
 * an exception, and the window's list is refreshed from the return value either way.
 */
export function deleteNote(
  noteRepo: ScratchpadRepository,
  userId: number,
  input: { id: number },
): { ok: true } | { ok: false; message: string } {
  const validated = deleteNoteSchema.parse(input);
  const removed = noteRepo.delete(userId, validated.id);
  return removed ? { ok: true } : { ok: false, message: "That note no longer exists." };
}
