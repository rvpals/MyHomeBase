"use server";

import { revalidatePath } from "next/cache";
import { clearMenuItemOverride, setMenuItemOverride, type MenuItem } from "@/lib/menu-items";
import { listModules } from "@/lib/modules";
import { deps } from "@/lib/wiring";
import { createMenuItemSource } from "../../../menu-item-source";
import { requireAdmin } from "../../../require-access";

export interface SaveMenuItemResult {
  ok: boolean;
  item?: MenuItem;
  error?: string;
}

/**
 * The registry source, rebuilt per call.
 *
 * Cheap — it is a walk over two in-memory registries plus one `listModules` read —
 * and deliberately not cached: a module renamed on the Module Configuration screen
 * must be reflected here on the next action, not after a restart.
 */
function source() {
  return createMenuItemSource(listModules(deps.moduleRepo, { includeHidden: true }));
}

/**
 * Revalidates every route, because a menu item's title is navigation chrome.
 *
 * `"layout"` and `"/"`: the navigation tree is rendered by shells on every page, so
 * revalidating just this route would leave the old title in the tree on every other
 * screen until something else happened to refresh them.
 */
function revalidateNavigation() {
  revalidatePath("/", "layout");
}

/**
 * Retitles or re-describes one menu item.
 *
 * `requireAdmin()` on the first line. The `/admin` layout already redirects a
 * non-admin, which covers the *screen* but not this endpoint: a server action is its
 * own POST route, reachable by anyone who can post to it.
 *
 * Validation — the shape of the id, the length caps, and that the id names a real
 * menu item — belongs to the lib's `setMenuItemOverride`, not to this adapter. It
 * throws on a bad payload and the catch turns that into a message the form shows.
 */
export async function saveMenuItemAction(input: {
  menuItemId: string;
  title?: string;
  hint?: string;
}): Promise<SaveMenuItemResult> {
  try {
    await requireAdmin();
    const item = setMenuItemOverride(source(), deps.menuItemOverrideRepo, input);
    revalidateNavigation();
    return { ok: true, item };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to save the menu item.",
    };
  }
}

/** Restores one menu item to the title and description its section file declares. */
export async function resetMenuItemAction(menuItemId: string): Promise<SaveMenuItemResult> {
  try {
    await requireAdmin();
    const item = clearMenuItemOverride(source(), deps.menuItemOverrideRepo, menuItemId);
    revalidateNavigation();
    return { ok: true, item };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to reset the menu item.",
    };
  }
}
