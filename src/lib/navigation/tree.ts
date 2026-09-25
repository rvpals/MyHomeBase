// Builds the navigation tree: Home, then every module the reader can reach.
//
// Data in, data out — the module list and a `SectionSource`, back a `NavigationTree`.
// No React, no database, no `src/app/` import. The web shell and a CLI command that
// prints the tree call exactly this.

import type { SectionSource } from "./ports";
import type { NavigationTree, TreeModule, TreeSection } from "./types";

/** The Home leaf, the one top-level destination that belongs to no module. */
export const HOME_SECTION: TreeSection = {
  id: "home",
  label: "Home",
  href: "/home",
  hint: "The dashboard you land on.",
  icon: "home",
};

/** One module the tree can show. The subset of a module row navigation needs. */
export interface NavigationModuleInput {
  slug: string;
  shortName: string;
  icon: string;
  description?: string;
}

/**
 * The tree for one reader.
 *
 * `modules` is expected to be **already filtered by access** — this function does no
 * authorisation of its own. That is deliberate: `getAccessibleModules` already owns
 * that decision and takes the user and their overrides to make it, and a second
 * access rule here would be a place for the two to disagree about who may see what.
 * The caller hands over the list it would have drawn in the rail.
 *
 * A module with no sections is **kept**, as a heading that expands to nothing. It is
 * a real state (a module registered before its shell exists) and hiding the heading
 * would make a half-built module invisible rather than obviously unfinished.
 */
export function buildNavigationTree(
  modules: NavigationModuleInput[],
  sections: SectionSource,
): NavigationTree {
  return {
    home: HOME_SECTION,
    modules: modules.map(
      (appModule): TreeModule => ({
        slug: appModule.slug,
        name: appModule.shortName,
        href: `/modules/${appModule.slug}`,
        icon: appModule.icon,
        hint: appModule.description,
        sections: sections.sectionsFor(appModule.slug),
      }),
    ),
  };
}

/** Every section in the tree, with the module it came from. Used by the filter. */
export function flattenTree(tree: NavigationTree): { module: TreeModule; section: TreeSection }[] {
  return tree.modules.flatMap((module) =>
    module.sections.map((section) => ({ module, section })),
  );
}

/**
 * Which module owns a path, or `undefined` for Home and anything outside a module.
 *
 * Prefix matching, not equality: a section's own sub-routes (`/modules/journal/entries/42`)
 * have to keep their module expanded, and an exact match would collapse the tree the
 * moment a reader opened a record.
 */
export function findActiveModule(tree: NavigationTree, pathname: string): TreeModule | undefined {
  return tree.modules.find(
    (module) => pathname === module.href || pathname.startsWith(`${module.href}/`),
  );
}

/**
 * The section whose href the path is on, or `undefined`.
 *
 * Longest href first, so `/modules/journal/locations/map` matches the map section
 * rather than the `locations` section it is prefixed by. Sorting rather than
 * requiring the caller to order its sections keeps the rule here, where the bug
 * would otherwise be silent and only on modules with nested slugs.
 */
export function findActiveSection(
  tree: NavigationTree,
  pathname: string,
): { module: TreeModule; section: TreeSection } | undefined {
  const candidates = flattenTree(tree)
    .filter(({ section }) => pathname === section.href || pathname.startsWith(`${section.href}/`))
    .sort((a, b) => b.section.href.length - a.section.href.length);
  return candidates[0];
}
