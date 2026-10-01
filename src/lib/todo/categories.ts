import type { TodoCategoryRepository, TodoItemRepository } from "./ports";
import {
  CATEGORY_LIMIT,
  createCategorySchema,
  deleteCategorySchema,
  renameCategorySchema,
  reorderCategoriesSchema,
} from "./schema";
import type { CategoryDeleteResult, TodoCategory } from "./types";

/** Every list, in the arranged order — the side panel and the widget's tab strip. */
export function listCategories(repo: TodoCategoryRepository): TodoCategory[] {
  return repo.list();
}

/**
 * Adds a list at the end of the panel.
 *
 * Both failures return a message rather than throwing, because both are ordinary
 * mistakes the screen has to render: a duplicate name, and a full panel.
 *
 * The duplicate check is **case-insensitive** and happens here rather than relying on
 * the unique index. The index is the backstop that keeps the data honest under a race;
 * this is what produces a sentence someone can act on instead of a constraint error.
 */
export function createCategory(
  repo: TodoCategoryRepository,
  input: { name: string },
): { ok: true; category: TodoCategory } | { ok: false; message: string } {
  const validated = createCategorySchema.parse(input);

  if (repo.count() >= CATEGORY_LIMIT) {
    return { ok: false, message: `There can be at most ${CATEGORY_LIMIT} lists.` };
  }

  if (repo.isNameTaken(validated.name)) {
    return { ok: false, message: `There is already a list called "${validated.name}".` };
  }

  return { ok: true, category: repo.create(validated.name) };
}

/**
 * Renames a list.
 *
 * `exceptId` on the uniqueness check is what makes recapitalising a list work: renaming
 * "work" to "Work" must not collide with itself. Without it the only way to fix a
 * capitalisation would be to delete the list — which is refused while it holds items, so
 * the reader would be stuck.
 *
 * Items are untouched. They reference the list by id, so a rename is invisible to them —
 * which is the reason the list's name is not stored on the item.
 */
export function renameCategory(
  repo: TodoCategoryRepository,
  input: { id: number; name: string },
): { ok: true; category: TodoCategory } | { ok: false; message: string } {
  const validated = renameCategorySchema.parse(input);

  if (!repo.findById(validated.id)) {
    return { ok: false, message: "That list no longer exists." };
  }

  if (repo.isNameTaken(validated.name, validated.id)) {
    return { ok: false, message: `There is already a list called "${validated.name}".` };
  }

  const category = repo.rename(validated.id, validated.name);
  // The findById above passed, so a miss here means the row went between the two reads.
  // Reported rather than asserted away with `!`: the screen can render "no longer
  // exists" perfectly well, and a non-null assertion would be a promise about a check
  // several lines up that nothing would re-verify if this function changed.
  if (!category) return { ok: false, message: "That list no longer exists." };

  return { ok: true, category };
}

/**
 * Rearranges the panel.
 *
 * Unknown ids are dropped rather than rejected, and ids that exist but weren't sent keep
 * their current position — a stale screen that posts a since-deleted list should still
 * move the ones that remain. The repository applies the whole array in one write, so the
 * panel is never left half-ordered.
 */
export function reorderCategories(
  repo: TodoCategoryRepository,
  input: { ids: readonly number[] },
): TodoCategory[] {
  const validated = reorderCategoriesSchema.parse(input);
  return repo.reorder(validated.ids);
}

/**
 * Deletes a list, but only while it is empty.
 *
 * **Refused rather than cascading**, and the refusal names the count so it reads as an
 * instruction rather than a wall. Migration 0123 records why: cascading would let one
 * person destroy commitments the rest of the household is relying on, and these items
 * are shared, so the person deleting is not necessarily the person who wrote them.
 *
 * "Empty" means *both* halves. A list holding only completed items is still a record of
 * what was done, and dropping 146 finished errands to tidy the panel is exactly the data
 * loss this guard exists to prevent — the fix is to clear them deliberately first.
 */
export function deleteCategory(
  categoryRepo: TodoCategoryRepository,
  itemRepo: TodoItemRepository,
  input: { id: number },
): CategoryDeleteResult {
  const validated = deleteCategorySchema.parse(input);

  if (!categoryRepo.findById(validated.id)) {
    return { ok: false, message: "That list no longer exists." };
  }

  const { open, completed } = itemRepo.countsForCategory(validated.id);
  const total = open + completed;
  if (total > 0) {
    return {
      ok: false,
      message:
        `That list still has ${total} ${total === 1 ? "item" : "items"} in it ` +
        `(${open} to do, ${completed} completed). Remove them first.`,
    };
  }

  categoryRepo.delete(validated.id);
  return { ok: true };
}
