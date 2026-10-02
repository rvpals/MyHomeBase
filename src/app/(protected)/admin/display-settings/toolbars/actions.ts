"use server";

import { revalidatePath } from "next/cache";
import { listMenuItems } from "@/lib/menu-items";
import { listModules } from "@/lib/modules";
import {
  addToolbarItem,
  createToolbar,
  deleteToolbar,
  removeToolbarItem,
  reorderToolbarItems,
  updateToolbar,
  updateToolbarItem,
  type ToolbarInput,
  type ToolbarItemInput,
  type ToolbarWithItems,
} from "@/lib/toolbars";
import { deps } from "@/lib/wiring";
import { createMenuItemSource } from "../../../menu-item-source";
import { requireAdmin } from "../../../require-access";

export interface ToolbarActionResult {
  ok: boolean;
  toolbar?: ToolbarWithItems;
  error?: string;
}

/**
 * The menu item ids a toolbar row may point at.
 *
 * Read per call rather than cached: a section added or a module unhidden since the
 * page loaded should be pointable at without a restart.
 */
function knownMenuItemIds(): string[] {
  const modules = listModules(deps.moduleRepo, { includeHidden: true });
  return listMenuItems(createMenuItemSource(modules), deps.menuItemOverrideRepo).map(
    (item) => item.id,
  );
}

/**
 * Revalidates every route.
 *
 * A toolbar is rendered by the protected layout, which every authenticated page
 * shares — revalidating just this route would leave the old bar on every other
 * screen. Same reasoning as the Menu Items actions.
 */
function revalidateChrome() {
  revalidatePath("/", "layout");
}

/** Wraps an admin-guarded write, so each action below is its own two lines. */
async function guarded(run: () => ToolbarWithItems | undefined): Promise<ToolbarActionResult> {
  try {
    // `requireAdmin()` first. The `/admin` layout redirects a non-admin, which covers
    // the *screen* but not this endpoint: a server action is its own POST route.
    await requireAdmin();
    const toolbar = run();
    revalidateChrome();
    return { ok: true, toolbar };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "The change could not be saved.",
    };
  }
}

export async function createToolbarAction(input: ToolbarInput): Promise<ToolbarActionResult> {
  return guarded(() => createToolbar(deps.toolbarRepo, input));
}

export async function updateToolbarAction(
  id: number,
  input: ToolbarInput,
): Promise<ToolbarActionResult> {
  return guarded(() => updateToolbar(deps.toolbarRepo, id, input));
}

export async function deleteToolbarAction(id: number): Promise<ToolbarActionResult> {
  return guarded(() => {
    deleteToolbar(deps.toolbarRepo, id);
    return undefined;
  });
}

export async function addToolbarItemAction(
  toolbarId: number,
  input: ToolbarItemInput,
): Promise<ToolbarActionResult> {
  return guarded(() => {
    addToolbarItem(deps.toolbarRepo, toolbarId, input, knownMenuItemIds());
    return deps.toolbarRepo.getToolbar(toolbarId);
  });
}

export async function updateToolbarItemAction(
  toolbarId: number,
  itemId: number,
  input: ToolbarItemInput,
): Promise<ToolbarActionResult> {
  return guarded(() => {
    updateToolbarItem(deps.toolbarRepo, itemId, input, knownMenuItemIds());
    return deps.toolbarRepo.getToolbar(toolbarId);
  });
}

export async function removeToolbarItemAction(
  toolbarId: number,
  itemId: number,
): Promise<ToolbarActionResult> {
  return guarded(() => {
    removeToolbarItem(deps.toolbarRepo, itemId);
    return deps.toolbarRepo.getToolbar(toolbarId);
  });
}

export async function reorderToolbarItemsAction(
  toolbarId: number,
  itemIds: number[],
): Promise<ToolbarActionResult> {
  return guarded(() => {
    reorderToolbarItems(deps.toolbarRepo, toolbarId, itemIds);
    return deps.toolbarRepo.getToolbar(toolbarId);
  });
}
