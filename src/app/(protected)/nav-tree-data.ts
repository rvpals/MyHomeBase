// The navigation tree, assembled for one reader.
//
// Every shell needs the identical four values, and before this they each rebuilt
// the module list inline — ten copies of the same `getAccessibleModules(...).map()`.
// The tree needs that list *plus* every module's sections, which is more than worth
// duplicating ten times, so it is assembled once here.
//
// A plain async function rather than a component: the shells are server components
// and call this before rendering, the same way they call `getUserPreferences`.

import { ADMIN_TREE_MODULE } from "./admin-tree-module";
import { adminMenuItemId, createMenuItemSource, moduleMenuItemId } from "./menu-item-source";
import { moduleSectionSource } from "./module-sections";
import { buildNavigationTree, type NavigationTree, type TreeModule, type TreeSection } from "@/lib/navigation";
import { overriddenTitles } from "@/lib/menu-items";
import { getUserPreferences } from "@/lib/user-preferences";
import { getAccessibleModules } from "@/lib/user";
import type { User } from "@/lib/user";
import { listModules } from "@/lib/modules";
import { listDashboardTextures } from "@/lib/dashboard-texture";
import { getSetting } from "@/lib/settings";
import {
  NAV_TEXTURE_ID_KEY,
  NAV_TEXTURE_OPACITY_KEY,
  resolveNavTexture,
  type ResolvedNavTexture,
} from "@/lib/nav-texture";
import { deps } from "@/lib/wiring";

/**
 * Applies administrator renames to a module's sections.
 *
 * A menu item's title is authoritative wherever the navigation shows it — the tree,
 * the breadcrumb and the compact bar all render from these same `TreeSection`s, so
 * overriding here covers all three from one place rather than three.
 *
 * The map holds **only** renamed items (see `overriddenTitles`), so on an install
 * where nothing has been renamed this is a no-op over an empty object and every
 * label is the one the section file declares.
 */
function withOverriddenLabels(
  sections: TreeSection[],
  titles: Record<string, string>,
  idFor: (sectionId: string) => string,
): TreeSection[] {
  if (Object.keys(titles).length === 0) return sections;
  return sections.map((section) => {
    const title = titles[idFor(section.id)];
    return title ? { ...section, label: title } : section;
  });
}

export interface NavTreeData {
  tree: NavigationTree;
  expandedModules: string[];
  adminTreeModule: TreeModule;
  /** The flat module list tier 1 still needs — the compact bar renders from it. */
  links: { slug: string; name: string; href: string; icon: string; hint?: string }[];
  /**
   * The navigation's optional background picture, or `undefined` for a plain
   * column. Resolved here rather than in each shell for the same reason the tree
   * is: ten shells each reading two settings and the texture library is ten
   * copies of one fact, and they would drift.
   */
  navTexture?: ResolvedNavTexture;
}

/**
 * The tree, the reader's expanded set, and the module links the compact bar uses.
 *
 * `getAccessibleModules` decides visibility, exactly as it does for the rail — the
 * tree does no access filtering of its own, so a module hidden from one reader is
 * absent from their tree for the same single reason it was absent from their rail.
 */
export function getNavTreeData(currentUser: User): NavTreeData {
  // Read once and used twice: `getAccessibleModules` filters this for the tree, while
  // the menu item registry needs the unfiltered list. Two `listModules` calls on a
  // path that runs for every page render would be two queries for one fact.
  const allModules = listModules(deps.moduleRepo, { includeHidden: true });
  const accessibleModules = getAccessibleModules(
    currentUser,
    // `getAccessibleModules` has always been handed the visible list; hidden modules
    // are not its job to filter and passing them would change who sees what.
    allModules.filter((appModule) => appModule.isVisible),
    deps.userRepo,
  );

  // Renamed menu items, as `id -> title`. Read once here rather than per row: the
  // tree resolves a label for every section on every render, and the registry is
  // one read of a table that is empty until an admin renames something.
  const titles = overriddenTitles(createMenuItemSource(allModules), deps.menuItemOverrideRepo);

  return {
    tree: buildNavigationTree(
      accessibleModules.map((appModule) => ({
        slug: appModule.slug,
        shortName: appModule.shortName,
        icon: appModule.icon,
        description: appModule.description,
      })),
      {
        sectionsFor: (moduleSlug) =>
          withOverriddenLabels(moduleSectionSource.sectionsFor(moduleSlug), titles, (sectionId) =>
            moduleMenuItemId(moduleSlug, sectionId),
          ),
      },
    ),
    expandedModules: getUserPreferences(deps.userPreferencesRepo, currentUser.id).expandedModules,
    adminTreeModule: {
      ...ADMIN_TREE_MODULE,
      sections: withOverriddenLabels(ADMIN_TREE_MODULE.sections, titles, adminMenuItemId),
    },
    links: accessibleModules.map((appModule) => ({
      slug: appModule.slug,
      name: appModule.shortName,
      href: `/modules/${appModule.slug}`,
      icon: appModule.icon,
      hint: appModule.description,
    })),
    // Two settings rows and the texture library. The library read is the same
    // cheap one the protected layout already does for personal toolbars — every
    // row carries `hasImage`, never the picture's bytes (migration 0113).
    navTexture: resolveNavTexture(
      {
        id: getSetting(deps.settingsRepo, NAV_TEXTURE_ID_KEY)?.value,
        opacity: getSetting(deps.settingsRepo, NAV_TEXTURE_OPACITY_KEY)?.value,
      },
      listDashboardTextures(deps.dashboardTextureRepo),
    ),
  };
}
