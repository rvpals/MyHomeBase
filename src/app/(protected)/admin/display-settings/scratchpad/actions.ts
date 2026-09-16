"use server";

import { revalidatePath } from "next/cache";
import {
  createCategory,
  deleteCategory,
  describeDeleteRefusal,
  listCategories,
  renameCategory,
  reorderCategories,
  type NoteCategory,
} from "@/lib/scratchpad";
import { deps } from "@/lib/wiring";
import { requireAdmin } from "../../../require-access";

export interface ScratchpadCategoriesResult {
  ok: boolean;
  error?: string;
  categories?: NoteCategory[];
}

/**
 * The Scratchpad's category actions.
 *
 * `requireAdmin()` on the first line of each. The `/admin` layout already redirects a
 * non-admin, which covers the *screen* but not these endpoints: a server action is its
 * own POST route, reachable by anyone who can post to it.
 *
 * Validation — the name's length and shape, the uniqueness check, the caps — belongs to
 * the lib's use-cases, not to these adapters. They return a message for the ordinary
 * refusals an admin can cause (a duplicate name, a full strip, a category with notes in
 * it) and throw only on genuinely malformed input, which the catch turns into something
 * the form can show.
 *
 * Each returns the **stored** strip so the screen renders what actually saved rather than
 * what it hoped for, and each revalidates the layout — the Scratchpad's window is
 * mounted by the protected layout that every page shares, so a renamed tab has to reach
 * every open page, not just this route.
 */
export async function createScratchpadCategoryAction(
  name: string,
): Promise<ScratchpadCategoriesResult> {
  try {
    await requireAdmin();
    const result = createCategory(deps.noteCategoryRepo, { name });
    if (!result.ok) return { ok: false, error: result.message };
    revalidatePath("/", "layout");
    return { ok: true, categories: listCategories(deps.noteCategoryRepo) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to add the category.",
    };
  }
}

export async function renameScratchpadCategoryAction(input: {
  id: number;
  name: string;
}): Promise<ScratchpadCategoriesResult> {
  try {
    await requireAdmin();
    const result = renameCategory(deps.noteCategoryRepo, input);
    if (!result.ok) return { ok: false, error: result.message };
    revalidatePath("/", "layout");
    return { ok: true, categories: listCategories(deps.noteCategoryRepo) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to rename the category.",
    };
  }
}

/** Rewrites the whole strip's order — see `reorderCategoriesSchema` on why the whole list. */
export async function reorderScratchpadCategoriesAction(
  ids: number[],
): Promise<ScratchpadCategoriesResult> {
  try {
    await requireAdmin();
    const categories = reorderCategories(deps.noteCategoryRepo, { ids });
    revalidatePath("/", "layout");
    return { ok: true, categories };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to reorder the categories.",
    };
  }
}

/**
 * Deletes a category — **refused while any note is filed under it.**
 *
 * The guard is the use-case's, and `describeDeleteRefusal` turns its reason into the
 * sentence shown here rather than this adapter assembling one: the phrasing and the
 * pluralisation are identical in the CLI, and a message built in a route is the one that
 * drifts.
 *
 * The refusal an admin sees carries counts only — how many notes, by how many people.
 * Never any note text and never a username.
 */
export async function deleteScratchpadCategoryAction(
  id: number,
): Promise<ScratchpadCategoriesResult> {
  try {
    await requireAdmin();
    const result = deleteCategory(deps.noteCategoryRepo, { id });
    if (!result.ok) return { ok: false, error: describeDeleteRefusal(result) };
    revalidatePath("/", "layout");
    return { ok: true, categories: listCategories(deps.noteCategoryRepo) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to delete the category.",
    };
  }
}
