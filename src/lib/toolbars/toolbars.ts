// The toolbar use-cases. Pure functions over a repository and a menu item registry.

import type { MenuItem } from "@/lib/menu-items";
import type { ToolbarRepository } from "./ports";
import { toolbarItemSchema, toolbarSchema, type ToolbarInput, type ToolbarItemInput } from "./schema";
import { isOrnamentalKind } from "./types";
import type {
  ResolvedToolbar,
  ResolvedToolbarItem,
  Toolbar,
  ToolbarItem,
  ToolbarWithItems,
} from "./types";

export function listToolbars(repo: ToolbarRepository): ToolbarWithItems[] {
  return repo.listToolbars();
}

export function getToolbar(repo: ToolbarRepository, id: number): ToolbarWithItems | undefined {
  return repo.getToolbar(id);
}

export function createToolbar(repo: ToolbarRepository, input: ToolbarInput): ToolbarWithItems {
  return repo.createToolbar(toolbarSchema.parse(input));
}

export function updateToolbar(
  repo: ToolbarRepository,
  id: number,
  input: ToolbarInput,
): ToolbarWithItems {
  const parsed = toolbarSchema.parse(input);
  requireToolbar(repo, id);
  repo.updateToolbar(id, parsed);
  return repo.getToolbar(id)!;
}

export function deleteToolbar(repo: ToolbarRepository, id: number): void {
  requireToolbar(repo, id);
  repo.deleteToolbar(id);
}

/**
 * Appends a row.
 *
 * `knownMenuItemIds` is the registry's current ids. A `menu-item` row pointing at
 * something that does not exist is rejected *here*, on the way in, because that is
 * the one moment the mistake is fixable — the picker can say "pick a screen". It is
 * deliberately not re-checked on read: a section removed in a later release turns a
 * valid stored row into a stale one through no fault of the admin, and `resolveToolbar`
 * drops it quietly rather than breaking the bar.
 */
export function addToolbarItem(
  repo: ToolbarRepository,
  toolbarId: number,
  input: ToolbarItemInput,
  knownMenuItemIds: readonly string[],
): ToolbarItem {
  const parsed = toolbarItemSchema.parse(input);
  requireToolbar(repo, toolbarId);
  requireKnownMenuItem(parsed, knownMenuItemIds);
  return repo.addItem(toolbarId, parsed);
}

export function updateToolbarItem(
  repo: ToolbarRepository,
  itemId: number,
  input: ToolbarItemInput,
  knownMenuItemIds: readonly string[],
): void {
  const parsed = toolbarItemSchema.parse(input);
  requireKnownMenuItem(parsed, knownMenuItemIds);
  repo.updateItem(itemId, parsed);
}

export function removeToolbarItem(repo: ToolbarRepository, itemId: number): void {
  repo.removeItem(itemId);
}

/**
 * Rearranges one toolbar's rows.
 *
 * Rejects a list that is not exactly the toolbar's current rows: a partial list
 * would silently drop whatever it omitted to the end in an arbitrary order, and an
 * id from another toolbar would move a row between bars as a side effect of a
 * reorder.
 */
export function reorderToolbarItems(
  repo: ToolbarRepository,
  toolbarId: number,
  itemIds: number[],
): void {
  const toolbar = requireToolbar(repo, toolbarId);
  const current = new Set(toolbar.items.map((item) => item.id));
  const next = new Set(itemIds);

  if (next.size !== itemIds.length) throw new Error("The new order repeats an item.");
  if (next.size !== current.size || [...next].some((id) => !current.has(id))) {
    throw new Error("The new order must list exactly this toolbar's items.");
  }

  repo.setItemOrder(toolbarId, itemIds);
}

/**
 * One toolbar, ready to render, or `undefined` when nothing should be drawn.
 *
 * Three filters, in order:
 *
 * 1. **Hidden by the admin** — `isVisible: false` removes it for everyone.
 * 2. **Hidden by this reader** — their own preference, passed in as `hiddenIds`.
 * 3. **`fullModeOnly` on a compact layout** — see the flag's own note.
 *
 * Then rows are resolved and **stale ones dropped**. A `menu-item` row whose id no
 * longer names anything is removed rather than rendered: menu items come from code,
 * not a table, so there is no foreign key to prevent a section from disappearing out
 * from under a stored row, and a dead button is worse than a missing one.
 *
 * A toolbar left with no *actionable* rows returns `undefined`. A bar showing only
 * ornament is a coloured stripe with no purpose, and on a side edge it would reserve
 * space for nothing.
 */
export function resolveToolbar(
  toolbar: ToolbarWithItems,
  menuItems: readonly MenuItem[],
  options: { isCompact: boolean; hiddenIds: readonly number[] },
): ResolvedToolbar | undefined {
  if (!toolbar.isVisible) return undefined;
  if (options.hiddenIds.includes(toolbar.id)) return undefined;
  if (toolbar.fullModeOnly && options.isCompact) return undefined;

  const byId = new Map(menuItems.map((item) => [item.id, item]));

  // The annotation is load-bearing: without it the branches below infer
  // differently-shaped object literals and the union does not assign to
  // `ResolvedToolbarItem[]`.
  const items = toolbar.items.flatMap((item): ResolvedToolbarItem[] => {
    // Both ornamental kinds pass through carrying nothing but their identity — a
    // separator draws a line, a spacer takes the slack, and neither needs data.
    if (isOrnamentalKind(item.kind)) return [{ id: item.id, kind: item.kind }];

    const menuItem = item.menuItemId ? byId.get(item.menuItemId) : undefined;
    if (!menuItem) return [];

    return [
      {
        id: item.id,
        kind: item.kind,
        // The row's own label wins when set — a per-toolbar nickname — otherwise
        // the menu item's current title, so an admin rename on the Menu Items
        // screen flows through to every toolbar that points at it.
        label: item.label ?? menuItem.title,
        href: menuItem.href,
        icon: menuItem.icon,
        menuItemId: menuItem.id,
      },
    ];
  });

  if (!items.some((item) => item.kind === "menu-item")) return undefined;

  return {
    id: toolbar.id,
    name: toolbar.name,
    backgroundColor: toolbar.backgroundColor,
    borderColor: toolbar.borderColor,
    textColor: toolbar.textColor,
    edge: toolbar.edge,
    fullModeOnly: toolbar.fullModeOnly,
    items: trimEdgeOrnament(items),
  };
}

/**
 * Every toolbar this reader should see right now.
 *
 * One function so the shell has a single call, and so the "which bars are on
 * screen" rule lives in `lib` where it is testable without a browser.
 */
export function resolveToolbarsFor(
  toolbars: readonly ToolbarWithItems[],
  menuItems: readonly MenuItem[],
  options: { isCompact: boolean; hiddenIds: readonly number[] },
): ResolvedToolbar[] {
  return toolbars
    .map((toolbar) => resolveToolbar(toolbar, menuItems, options))
    .filter((toolbar): toolbar is ResolvedToolbar => toolbar !== undefined);
}

/**
 * Drops ornament that ended up at either end, and collapses adjacent duplicates.
 *
 * Both ornamental kinds sit *between* two things, so one at the start or end is
 * decoration with nothing to decorate: a separator there draws a line along the
 * bar's own border, and a spacer there just shoves everything to one side.
 *
 * Adjacent duplicates collapse because two in a row is almost always what is left
 * behind when the item between them was deleted — not worth making an admin tidy by
 * hand. **Only a run of the *same* kind collapses**: a separator next to a spacer is
 * a deliberate and useful arrangement (divide here, *then* push the rest to the
 * end), and merging those two would silently change the layout an admin built.
 */
function trimEdgeOrnament<T extends { kind: ToolbarItem["kind"] }>(items: T[]): T[] {
  const collapsed = items.filter(
    (item, index) => !isOrnamentalKind(item.kind) || items[index - 1]?.kind !== item.kind,
  );
  let start = 0;
  let end = collapsed.length;
  while (start < end && isOrnamentalKind(collapsed[start].kind)) start += 1;
  while (end > start && isOrnamentalKind(collapsed[end - 1].kind)) end -= 1;
  return collapsed.slice(start, end);
}

/**
 * Which edges currently have a visible toolbar, so the shell knows what to reserve.
 *
 * Returned as data rather than as pixels: `lib` owns *which* edges are occupied and
 * CSS owns how wide they are, the same split `resolvePuckSlots` makes for the
 * floating layer.
 */
export function occupiedEdges(toolbars: readonly ResolvedToolbar[]): Toolbar["edge"][] {
  const edges = new Set(toolbars.map((toolbar) => toolbar.edge));
  return [...edges];
}

function requireToolbar(repo: ToolbarRepository, id: number): ToolbarWithItems {
  const toolbar = repo.getToolbar(id);
  if (!toolbar) throw new Error(`No toolbar with the id ${id}.`);
  return toolbar;
}

/** A `menu-item` row must point at something the registry currently knows. */
function requireKnownMenuItem(
  item: { kind: string; menuItemId?: string },
  knownMenuItemIds: readonly string[],
): void {
  if (item.kind !== "menu-item") return;
  if (!item.menuItemId || !knownMenuItemIds.includes(item.menuItemId)) {
    throw new Error(`No menu item with the id "${item.menuItemId ?? ""}".`);
  }
}
