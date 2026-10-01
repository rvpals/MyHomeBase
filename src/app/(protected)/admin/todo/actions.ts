"use server";

// Administration → TODO Lists — the category actions.
//
// `requireAdmin()` on the first line of each. The `/admin` layout already redirects a
// non-admin, which covers the *screen* but not these endpoints: a server action is its
// own POST route, reachable by anyone who can post to it.
//
// These overlap deliberately with `tools-todo-actions.ts`, which does the same four
// things behind `requireModuleAccess("tools")`. The duplication is in the *guard*, not
// the logic — both call the same use-cases — and it is the point: adding a list while
// using the feature is ordinary, so the Tools screen allows it to anyone granted the
// module, while this screen is where an admin tidies up (rename, reorder, remove) in
// one place. Collapsing them would mean picking one guard for both, and neither is right
// for the other's screen.
//
// Validation — the name's length and shape, the uniqueness check, the caps — belongs to
// the lib's use-cases, not to these adapters. They return a message for the ordinary
// refusals an admin can cause (a duplicate name, a full panel, a list with items in it)
// and throw only on genuinely malformed input, which the catch turns into something the
// form can show.

import { revalidatePath } from "next/cache";
import {
  createCategory,
  deleteCategory,
  listCategories,
  renameCategory,
  reorderCategories,
  type TodoCategory,
} from "@/lib/todo";
import { deps } from "@/lib/wiring";
import { requireAdmin } from "../../require-access";

export interface TodoCategoriesResult {
  ok: boolean;
  error?: string;
  /** The **stored** panel, so the screen renders what saved rather than what it hoped for. */
  categories?: TodoCategory[];
}

const ADMIN_PATH = "/admin/todo";
const TODO_PATH = "/modules/tools/todo";
const HOME_PATH = "/";

/**
 * Every screen that draws these lists.
 *
 * Three paths, not one: the admin screen being edited, the Tools section, and the home
 * card. A rename that reached only this screen would leave the other two showing the old
 * name until something else happened to refresh them.
 */
function revalidateEverywhere(): void {
  revalidatePath(ADMIN_PATH);
  revalidatePath(TODO_PATH);
  revalidatePath(HOME_PATH);
}

function toErrorResult(error: unknown, fallback: string): TodoCategoriesResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

export async function createTodoListAction(name: string): Promise<TodoCategoriesResult> {
  try {
    await requireAdmin();
    const result = createCategory(deps.todoCategoryRepo, { name });
    if (!result.ok) return { ok: false, error: result.message };
    revalidateEverywhere();
    return { ok: true, categories: listCategories(deps.todoCategoryRepo) };
  } catch (error) {
    return toErrorResult(error, "Could not create that list.");
  }
}

export async function renameTodoListAction(
  id: number,
  name: string,
): Promise<TodoCategoriesResult> {
  try {
    await requireAdmin();
    const result = renameCategory(deps.todoCategoryRepo, { id, name });
    if (!result.ok) return { ok: false, error: result.message };
    revalidateEverywhere();
    return { ok: true, categories: listCategories(deps.todoCategoryRepo) };
  } catch (error) {
    return toErrorResult(error, "Could not rename that list.");
  }
}

export async function reorderTodoListsAction(ids: number[]): Promise<TodoCategoriesResult> {
  try {
    await requireAdmin();
    const categories = reorderCategories(deps.todoCategoryRepo, { ids });
    revalidateEverywhere();
    return { ok: true, categories };
  } catch (error) {
    return toErrorResult(error, "Could not reorder the lists.");
  }
}

export async function deleteTodoListAction(id: number): Promise<TodoCategoriesResult> {
  try {
    await requireAdmin();
    const result = deleteCategory(deps.todoCategoryRepo, deps.todoItemRepo, { id });
    if (!result.ok) return { ok: false, error: result.message };
    revalidateEverywhere();
    return { ok: true, categories: listCategories(deps.todoCategoryRepo) };
  } catch (error) {
    return toErrorResult(error, "Could not delete that list.");
  }
}
