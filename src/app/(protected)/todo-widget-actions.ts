"use server";

// The home TODO card's one write: ticking an item off.
//
// WHY `requireModuleAccess` AND NOT `requireUser`. Unlike `my-shortcuts-actions.ts`,
// which guards with `requireUser()` because the home screen owns the shortcuts, these
// rows belong to the Tools module. A home-screen widget drawing a module's data does not
// make that data the home screen's — so the guard is the module's, exactly as it is on
// the Tools screen itself, and someone without Tools cannot tick an item through the
// card any more than they could through the module.
//
// Adding, editing and deleting are deliberately NOT here. The card is a glance with a
// checkbox; everything else lives on the Tools screen, which is one click away through
// the card's own link.

import { revalidatePath } from "next/cache";
import { setItemDone, type TodoDeps } from "@/lib/todo";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "./require-access";

/** The module these rows belong to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "tools";

const todoDeps: TodoDeps = {
  categoryRepo: deps.todoCategoryRepo,
  itemRepo: deps.todoItemRepo,
};

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export async function setHomeTodoItemDoneAction(input: {
  id: number;
  isDone: boolean;
}): Promise<ActionResult> {
  try {
    // Inside the `try` because the guard throws and this returns `{ ok, error }` — a
    // denial has to render in the card rather than as an unhandled rejection.
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    const result = setItemDone(todoDeps, input);
    if (!result.ok) return { ok: false, error: result.message };
    // Both screens draw these rows, so both are revalidated — ticking on the home card
    // must not leave the Tools screen showing the item as outstanding.
    revalidatePath("/");
    revalidatePath("/modules/tools/todo");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not update that item.",
    };
  }
}
