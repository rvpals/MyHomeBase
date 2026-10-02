// The two seams the menu item registry needs: where the items come from, and where
// the overrides are stored.

import type { MenuItem, MenuItemOverride } from "./types";

/**
 * One menu item as the *catalogue* declares it, before any override is applied.
 *
 * The subset of `MenuItem` that a source can know. It carries no `title`/`hint` —
 * those are the resolved values — and no `isOverridden`, which is the registry's
 * conclusion rather than the source's input.
 */
export interface MenuItemSeed {
  id: string;
  kind: MenuItem["kind"];
  defaultTitle: string;
  defaultHint?: string;
  moduleSlug?: string;
  moduleName: string;
  href: string;
  group?: string;
  icon?: string;
}

/**
 * Supplies every menu item the app has, in navigation order.
 *
 * The same seam `SectionSource` is, for the same reason: the `*-sections.ts` files
 * and `adminNav` live under `src/app/`, next to the routes whose hrefs they build,
 * and **`src/lib/` may not import from `src/app/`**. So the registry declares what
 * it needs and the composition root supplies it — see
 * `src/app/(protected)/menu-item-source.ts`.
 *
 * Moving the section lists down into `lib` was rejected for `SectionSource` already
 * (its port file records why) and the reasoning is unchanged: a section list is
 * route knowledge, and splitting the slug from the route that serves it would put
 * two halves of one fact in two layers.
 *
 * Expected to be **derived, never hand-maintained**. The app's implementation walks
 * the same `SECTION_BUILDERS` and `adminNav` the navigation tree is built from, so
 * a new section becomes a menu item automatically and the two cannot drift.
 */
export interface MenuItemSource {
  /** Every item, in the order navigation presents them. Never throws. */
  listSeeds(): MenuItemSeed[];
}

/**
 * Stored administrator overrides for menu item titles and hints.
 *
 * Sparse — see `MenuItemOverride`. `remove` is how "Reset to default" is expressed;
 * there is no such thing as an override that restores the default, because that is
 * just the absence of a row.
 */
export interface MenuItemOverrideRepository {
  /**
   * Every override, for resolving the whole registry in one read.
   *
   * The registry is resolved on navigation renders, so this must stay one query over
   * a table that holds a row only per *changed* item — not per item.
   */
  listAll(): MenuItemOverride[];
  get(menuItemId: string): MenuItemOverride | undefined;
  upsert(override: MenuItemOverride): void;
  remove(menuItemId: string): void;
}
