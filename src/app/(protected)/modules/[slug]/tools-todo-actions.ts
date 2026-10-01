"use server";

// TODO Lists' server actions.
//
// Thin adapters, every one: authorise, validate through the module's zod schema, call
// the use-case through `@/lib/todo`, revalidate. No logic here — the refusals these
// return ("that list still has 2 items in it") are composed in `lib`, not assembled
// from a status code.
//
// TWO PATHS REVALIDATE, NOT ONE. Every write touches both the Tools screen and the home
// screen's TODO card, which draw the same shared rows. Revalidating only the screen the
// click came from would leave the other showing a stale count until something else
// happened to refresh it.

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import {
  clearCompleted,
  createCategory,
  createItem,
  deleteCategory,
  deleteItem,
  renameCategory,
  reorderCategories,
  reorderItems,
  setItemDone,
  updateItem,
  type TodoDeps,
} from "@/lib/todo";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "../../require-access";

/** The module these actions belong to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "tools";

const TODO_PATH = "/modules/tools/todo";
const HOME_PATH = "/";

/** The two repositories every use-case here needs, assembled from the composition root. */
const todoDeps: TodoDeps = {
  categoryRepo: deps.todoCategoryRepo,
  itemRepo: deps.todoItemRepo,
};

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function toErrorResult(error: unknown, fallback: string): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

/** Both screens that draw these rows. See the note at the top of the file. */
function revalidateTodo(): void {
  revalidatePath(TODO_PATH);
  revalidatePath(HOME_PATH);
}

/**
 * Who is adding an item, for `created_by`.
 *
 * Attribution only — the guard above already decided whether the caller may act, and
 * every item is actionable by everyone granted the module. A failure to resolve the
 * session therefore costs the attribution, not the write.
 */
async function currentUserId(): Promise<number | undefined> {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  return getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo)?.id;
}

export async function createTodoCategoryAction(input: { name: string }): Promise<ActionResult> {
  try {
    // Inside the `try`, deliberately: `requireModuleAccess` throws, and this action
    // returns `{ ok, error }`, so a denial has to render as an inline error rather than
    // an unhandled rejection. Same in every action below.
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    const result = createCategory(deps.todoCategoryRepo, input);
    if (!result.ok) return { ok: false, error: result.message };
    revalidateTodo();
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not create that list.");
  }
}

export async function renameTodoCategoryAction(input: {
  id: number;
  name: string;
}): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    const result = renameCategory(deps.todoCategoryRepo, input);
    if (!result.ok) return { ok: false, error: result.message };
    revalidateTodo();
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not rename that list.");
  }
}

export async function reorderTodoCategoriesAction(input: {
  ids: number[];
}): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    reorderCategories(deps.todoCategoryRepo, input);
    revalidateTodo();
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not reorder the lists.");
  }
}

export async function deleteTodoCategoryAction(input: { id: number }): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    const result = deleteCategory(deps.todoCategoryRepo, deps.todoItemRepo, input);
    if (!result.ok) return { ok: false, error: result.message };
    revalidateTodo();
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not delete that list.");
  }
}

export async function createTodoItemAction(input: {
  categoryId: number;
  title: string;
  notes?: string;
}): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    const result = createItem(todoDeps, input, await currentUserId());
    if (!result.ok) return { ok: false, error: result.message };
    revalidateTodo();
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not add that item.");
  }
}

export async function updateTodoItemAction(input: {
  id: number;
  title?: string;
  notes?: string;
}): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    const result = updateItem(todoDeps, input);
    if (!result.ok) return { ok: false, error: result.message };
    revalidateTodo();
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not save that item.");
  }
}

export async function setTodoItemDoneAction(input: {
  id: number;
  isDone: boolean;
}): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    const result = setItemDone(todoDeps, input);
    if (!result.ok) return { ok: false, error: result.message };
    revalidateTodo();
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not update that item.");
  }
}

export async function deleteTodoItemAction(input: { id: number }): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    const result = deleteItem(todoDeps, input);
    if (!result.ok) return { ok: false, error: result.message };
    revalidateTodo();
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not delete that item.");
  }
}

export async function reorderTodoItemsAction(input: {
  categoryId: number;
  ids: number[];
}): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    const result = reorderItems(todoDeps, input);
    if (!result.ok) return { ok: false, error: result.message };
    revalidateTodo();
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not reorder those items.");
  }
}

export async function clearTodoCompletedAction(input: {
  categoryId: number;
}): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    const result = clearCompleted(todoDeps, input);
    if (!result.ok) return { ok: false, error: result.message };
    revalidateTodo();
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not clear the completed items.");
  }
}
