// The menu item registry's use-cases. Pure functions over a source and a repository.
//
// Nothing here knows about React, routes, or SQLite. `listMenuItems` is the one
// function everything else is built on: the admin screen lists what it returns, the
// navigation tree reads titles from it, and a personal toolbar resolves its stored
// ids through it.

import type { MenuItemOverrideRepository, MenuItemSeed, MenuItemSource } from "./ports";
import { menuItemOverrideSchema, type MenuItemOverrideInput } from "./schema";
import type { MenuItem, MenuItemOverride } from "./types";

/**
 * Applies one override to one seed.
 *
 * A **blank** title is treated as no override, not as an empty title: the admin form
 * posts "" for a field the user cleared, and taking that at its word would render a
 * nameless row in the navigation tree with no way to fix it from the UI. The schema
 * rejects a blank title on write too — this is the second guard, for rows that
 * predate it or were written by the CLI.
 */
function resolve(seed: MenuItemSeed, override: MenuItemOverride | undefined): MenuItem {
  const title = override?.title?.trim();
  const hint = override?.hint?.trim();
  const hasTitle = Boolean(title);
  // A hint may legitimately be cleared to nothing — unlike a title, an item with no
  // description is a normal state (plenty of sections ship without one). So a blank
  // hint counts as an override, and renders as absent.
  const hasHint = hint !== undefined && override?.hint !== undefined;

  return {
    id: seed.id,
    kind: seed.kind,
    title: hasTitle ? title! : seed.defaultTitle,
    hint: hasHint ? hint || undefined : seed.defaultHint,
    defaultTitle: seed.defaultTitle,
    defaultHint: seed.defaultHint,
    isOverridden: hasTitle || hasHint,
    moduleSlug: seed.moduleSlug,
    moduleName: seed.moduleName,
    href: seed.href,
    group: seed.group,
    icon: seed.icon,
  };
}

/**
 * Every menu item in the app, with administrator overrides applied.
 *
 * Order is the source's — navigation order — because every consumer renders in it
 * and re-sorting per caller is how two screens end up disagreeing about where an
 * item sits.
 *
 * **Duplicate ids are dropped, first one wins.** Ids are derived from slugs, and two
 * sections sharing one would silently make a toolbar entry ambiguous and an icon
 * override apply to both. Dropping rather than throwing is deliberate and matches
 * `sectionsFor`: a half-built module must not take down every page behind the login.
 * `menu-items.test.ts` asserts the real catalogue has no duplicates, which is where
 * a genuine collision gets caught.
 */
export function listMenuItems(
  source: MenuItemSource,
  repo: MenuItemOverrideRepository,
): MenuItem[] {
  const overrides = new Map(repo.listAll().map((row) => [row.menuItemId, row]));
  const seen = new Set<string>();
  const items: MenuItem[] = [];

  for (const seed of source.listSeeds()) {
    if (seen.has(seed.id)) continue;
    seen.add(seed.id);
    items.push(resolve(seed, overrides.get(seed.id)));
  }

  return items;
}

/**
 * One menu item by id, or `undefined` when nothing matches.
 *
 * `undefined` rather than a throw because the common caller is a stored toolbar row
 * pointing at an item that has since been removed — a real state, and one a toolbar
 * must render around rather than crash on.
 */
export function resolveMenuItem(
  source: MenuItemSource,
  repo: MenuItemOverrideRepository,
  id: string,
): MenuItem | undefined {
  return listMenuItems(source, repo).find((item) => item.id === id);
}

/**
 * Every menu item owned by one module, in navigation order.
 *
 * What the toolbar builder's second step reads, once a module has been picked.
 * `"admin"` selects the Administration screens; Home belongs to no module and is
 * returned by neither — it is offered separately.
 */
export function listMenuItemsForModule(
  source: MenuItemSource,
  repo: MenuItemOverrideRepository,
  moduleSlug: string,
): MenuItem[] {
  return listMenuItems(source, repo).filter((item) => item.moduleSlug === moduleSlug);
}

/** The distinct modules that own at least one menu item, in navigation order. */
export function listMenuItemModules(
  source: MenuItemSource,
  repo: MenuItemOverrideRepository,
): { slug: string; name: string; count: number }[] {
  const groups = new Map<string, { slug: string; name: string; count: number }>();

  for (const item of listMenuItems(source, repo)) {
    if (!item.moduleSlug) continue;
    const existing = groups.get(item.moduleSlug);
    if (existing) existing.count += 1;
    else groups.set(item.moduleSlug, { slug: item.moduleSlug, name: item.moduleName, count: 1 });
  }

  return [...groups.values()];
}

/**
 * A title lookup for the navigation tree, as a plain map.
 *
 * The tree resolves titles for every row on every render, and doing that with
 * `resolveMenuItem` per row would re-read and re-resolve the whole registry once per
 * section. This returns `id -> title` for the overridden items **only**, so the tree
 * can fall back to the label it already has and the map stays empty on an install
 * where nothing has been renamed.
 */
export function overriddenTitles(
  source: MenuItemSource,
  repo: MenuItemOverrideRepository,
): Record<string, string> {
  const titles: Record<string, string> = {};
  for (const item of listMenuItems(source, repo)) {
    if (item.isOverridden && item.title !== item.defaultTitle) titles[item.id] = item.title;
  }
  return titles;
}

/**
 * Retitles or re-describes one menu item.
 *
 * Validates against the registry first: an id that names no menu item must never
 * reach the table, or the override becomes an orphan row that nothing renders and
 * nothing can delete through the UI. Same guard `saveOverride` applies to slot ids.
 *
 * Writing values that both match the registry's defaults **removes** the row rather
 * than storing a no-op, so "overridden" stays an honest flag on the admin list.
 */
export function setMenuItemOverride(
  source: MenuItemSource,
  repo: MenuItemOverrideRepository,
  input: MenuItemOverrideInput,
  now: () => Date = () => new Date(),
): MenuItem {
  const parsed = menuItemOverrideSchema.parse(input);

  const seed = source.listSeeds().find((candidate) => candidate.id === parsed.menuItemId);
  if (!seed) throw new Error(`No menu item with the id "${parsed.menuItemId}".`);

  const title = parsed.title?.trim();
  const hint = parsed.hint?.trim();
  const titleIsDefault = !title || title === seed.defaultTitle;
  const hintIsDefault = hint === undefined || hint === (seed.defaultHint ?? "");

  if (titleIsDefault && hintIsDefault) {
    repo.remove(parsed.menuItemId);
    return resolve(seed, undefined);
  }

  const override: MenuItemOverride = {
    menuItemId: parsed.menuItemId,
    title: titleIsDefault ? undefined : title,
    hint: hintIsDefault ? undefined : hint,
    updatedAt: now().toISOString(),
  };
  repo.upsert(override);
  return resolve(seed, override);
}

/** Restores one menu item to the registry's title and hint. */
export function clearMenuItemOverride(
  source: MenuItemSource,
  repo: MenuItemOverrideRepository,
  menuItemId: string,
): MenuItem {
  const seed = source.listSeeds().find((candidate) => candidate.id === menuItemId);
  if (!seed) throw new Error(`No menu item with the id "${menuItemId}".`);
  repo.remove(menuItemId);
  return resolve(seed, undefined);
}
