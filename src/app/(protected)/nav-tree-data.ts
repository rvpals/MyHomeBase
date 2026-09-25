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
import { moduleSectionSource } from "./module-sections";
import { buildNavigationTree, type NavigationTree, type TreeModule } from "@/lib/navigation";
import { getUserPreferences } from "@/lib/user-preferences";
import { getAccessibleModules } from "@/lib/user";
import type { User } from "@/lib/user";
import { listModules } from "@/lib/modules";
import { deps } from "@/lib/wiring";

export interface NavTreeData {
  tree: NavigationTree;
  expandedModules: string[];
  adminTreeModule: TreeModule;
  /** The flat module list tier 1 still needs — the compact bar renders from it. */
  links: { slug: string; name: string; href: string; icon: string; hint?: string }[];
}

/**
 * The tree, the reader's expanded set, and the module links the compact bar uses.
 *
 * `getAccessibleModules` decides visibility, exactly as it does for the rail — the
 * tree does no access filtering of its own, so a module hidden from one reader is
 * absent from their tree for the same single reason it was absent from their rail.
 */
export function getNavTreeData(currentUser: User): NavTreeData {
  const accessibleModules = getAccessibleModules(
    currentUser,
    listModules(deps.moduleRepo),
    deps.userRepo,
  );

  return {
    tree: buildNavigationTree(
      accessibleModules.map((appModule) => ({
        slug: appModule.slug,
        shortName: appModule.shortName,
        icon: appModule.icon,
        description: appModule.description,
      })),
      moduleSectionSource,
    ),
    expandedModules: getUserPreferences(deps.userPreferencesRepo, currentUser.id).expandedModules,
    adminTreeModule: ADMIN_TREE_MODULE,
    links: accessibleModules.map((appModule) => ({
      slug: appModule.slug,
      name: appModule.shortName,
      href: `/modules/${appModule.slug}`,
      icon: appModule.icon,
      hint: appModule.description,
    })),
  };
}
