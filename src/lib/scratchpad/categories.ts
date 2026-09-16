import type { NoteCategoryRepository } from "./ports";
import {
  CATEGORY_LIMIT,
  createCategorySchema,
  deleteCategorySchema,
  renameCategorySchema,
  reorderCategoriesSchema,
} from "./schema";
import type { CategoryDeleteResult, NoteCategory } from "./types";

/** Every category, in the admin's order — the tab strip. */
export function listCategories(repo: NoteCategoryRepository): NoteCategory[] {
  return repo.list();
}

/**
 * Adds a category to the end of the strip.
 *
 * Both failures return a message rather than throwing, because both are ordinary admin
 * mistakes the screen has to render: a duplicate name, and a full strip.
 *
 * The duplicate check is **case-insensitive** and happens here rather than relying on
 * the unique index. The index is the backstop that keeps the data honest under a race;
 * this is what produces a sentence an admin can act on instead of a constraint error.
 */
export function createCategory(
  repo: NoteCategoryRepository,
  input: { name: string },
): { ok: true; category: NoteCategory } | { ok: false; message: string } {
  const validated = createCategorySchema.parse(input);

  if (repo.count() >= CATEGORY_LIMIT) {
    return {
      ok: false,
      message: `There can be at most ${CATEGORY_LIMIT} categories.`,
    };
  }

  if (repo.isNameTaken(validated.name)) {
    return { ok: false, message: `There is already a category called "${validated.name}".` };
  }

  return { ok: true, category: repo.create(validated.name) };
}

/**
 * Renames a category.
 *
 * `exceptId` on the uniqueness check is what makes recapitalising a category work:
 * renaming "work" to "Work" must not collide with itself. Without it the only way to fix
 * a capitalisation would be to delete the tab — which is refused while it holds notes,
 * so the admin would be stuck.
 *
 * Notes are untouched. They reference the category by id, so a rename is invisible to
 * them — which is the reason the tab label is not stored on the note.
 */
export function renameCategory(
  repo: NoteCategoryRepository,
  input: { id: number; name: string },
): { ok: true; category: NoteCategory } | { ok: false; message: string } {
  const validated = renameCategorySchema.parse(input);

  if (!repo.findById(validated.id)) {
    return { ok: false, message: "That category no longer exists." };
  }

  if (repo.isNameTaken(validated.name, validated.id)) {
    return { ok: false, message: `There is already a category called "${validated.name}".` };
  }

  const renamed = repo.rename(validated.id, validated.name);
  // Checked rather than asserted: `findById` succeeded a moment ago, but a non-null
  // assertion here would turn a future change in `rename` into a confusing crash.
  if (!renamed) return { ok: false, message: "That category no longer exists." };

  return { ok: true, category: renamed };
}

/**
 * Rewrites the strip's order.
 *
 * Takes the **whole** list of ids rather than one id and a direction, so the strip can
 * never be left half-reordered by a failed second call. Ids that no longer exist are
 * dropped by the repository rather than failing the write: a stale admin screen posting
 * a category someone else just deleted should still reorder the ones that remain.
 *
 * Returns the stored strip, so the screen renders what was actually saved rather than
 * what it hoped for.
 */
export function reorderCategories(
  repo: NoteCategoryRepository,
  input: { ids: readonly number[] },
): NoteCategory[] {
  const validated = reorderCategoriesSchema.parse(input);
  return repo.reorder(validated.ids);
}

/**
 * Deletes a category — **refused while any note is filed under it.**
 *
 * This is the module's one genuinely destructive operation and the guard is the whole
 * point of it. Migration 0096 records why refusing beats the alternatives: cascading
 * would let an admin destroy other people's notes from a settings screen with no way for
 * a non-admin to recover them, and re-filing orphans into a reserved "Uncategorized" tab
 * would cost a permanent category that can't be renamed or removed.
 *
 * The refusal carries **counts only** — how many notes, and how many people wrote them.
 * No text and no usernames, because this exists to explain a refusal, not to show an
 * admin a summary of other people's notebooks.
 *
 * The emptiness check lives here rather than in the repository so it returns a reason the
 * screen can render; a repository that checked internally would make the guard silent,
 * and one that cascaded would make it bypassable.
 */
export function deleteCategory(
  repo: NoteCategoryRepository,
  input: { id: number },
): CategoryDeleteResult {
  const validated = deleteCategorySchema.parse(input);

  if (!repo.findById(validated.id)) {
    return { ok: false, refusal: { kind: "not-found" } };
  }

  const { noteCount, ownerCount } = repo.countNotes(validated.id);
  if (noteCount > 0) {
    return { ok: false, refusal: { kind: "not-empty", noteCount, ownerCount } };
  }

  repo.delete(validated.id);
  return { ok: true };
}

/**
 * A refusal as a sentence.
 *
 * In `lib` rather than the view because the pluralisation and the phrasing are the same
 * in the admin screen and in the CLI, and because a message assembled in a `.tsx` is the
 * one that drifts. The counts are the only facts it may mention.
 */
export function describeDeleteRefusal(result: CategoryDeleteResult): string | undefined {
  if (result.ok) return undefined;

  if (result.refusal.kind === "not-found") return "That category no longer exists.";

  const { noteCount, ownerCount } = result.refusal;
  const notes = noteCount === 1 ? "1 note is" : `${noteCount} notes are`;
  // "by you" is not knowable here — this counts across the household, and the admin
  // doing the deleting may or may not be one of the owners. So the phrasing stays
  // neutral about whose they are.
  const people = ownerCount === 1 ? "1 person" : `${ownerCount} people`;
  return `${notes} still filed under this category, written by ${people}. Empty it first.`;
}
