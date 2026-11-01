// The composition root for the menu item registry: every navigable destination in
// the app, derived from the registries that already exist.
//
// This is the `src/app/` half of `MenuItemSource` (`src/lib/menu-items/ports.ts`),
// exactly as `module-sections.ts` is the `src/app/` half of `SectionSource` — and it
// is built on top of that one rather than beside it, so the two cannot disagree
// about what sections exist.
//
// **Derived, never hand-maintained.** Adding a section to a `*-sections.ts` file
// makes it a menu item automatically; there is no list here to remember to update
// and no id to allocate. That is the whole reason the id is the icon slot id — see
// `src/lib/menu-items/types.ts`.
//
// **Not a "use client" module**, for the same load-bearing reason `module-sections.ts`
// isn't: the shells and the admin page are server components and read these values
// directly, so a client directive anywhere in this chain would hand the server
// client-reference proxies instead of the real objects.

import type { MenuItemSeed, MenuItemSource } from "@/lib/menu-items";
import { HOME_SECTION } from "@/lib/navigation";
import { sectionSlotId } from "@/lib/icons";
import { ADMIN_TREE_MODULE } from "./admin-tree-module";
import { moduleSectionSource } from "./module-sections";

/**
 * Module slug to the icon namespace its section slots are registered under.
 *
 * **These are not always the same string**, and that is the trap this map exists to
 * close. Three modules were renamed after their slots were registered, and the slot
 * ids deliberately did not follow — renaming one orphans every uploaded icon:
 *
 * | Module slug | Namespace | Why they differ |
 * |---|---|---|
 * | `investments` | `stock` | Migration 0108 renamed the module, not the slots |
 * | `csv-analysis` | `csv` | The shell has always passed the short form |
 * | `picture-gallery` | `gallery` | Likewise |
 * | `music-library` | `music` | Likewise |
 *
 * The values here must match each shell's `iconNamespace` prop exactly, because that
 * is what `SectionPanel` derives the live icon slot from. A mismatch does not throw
 * — it silently produces a menu item id that addresses no registered slot, so the
 * item's icon would never match the one the nav draws. `menu-item-source.test.ts`
 * resolves every derived id against `ICON_SLOTS`, which is what caught two of these
 * four when this map was first written with only three entries.
 */
const ICON_NAMESPACES: Record<string, string> = {
  investments: "stock",
  "csv-analysis": "csv",
  "picture-gallery": "gallery",
  "music-library": "music",
};

/** The icon namespace for a module slug — itself, unless the table above says otherwise. */
function namespaceFor(moduleSlug: string): string {
  return ICON_NAMESPACES[moduleSlug] ?? moduleSlug;
}

/**
 * The menu item id for one module section.
 *
 * Exported because a toolbar's stored rows and any future consumer need to build the
 * same string from a (module, section) pair, and re-deriving it by hand is how two
 * callers end up addressing different items.
 */
export function moduleMenuItemId(moduleSlug: string, sectionSlug: string): string {
  return sectionSlotId(namespaceFor(moduleSlug), sectionSlug);
}

/** The menu item id for one Administration screen, from its `adminNav` node id. */
export function adminMenuItemId(nodeId: string): string {
  return sectionSlotId("admin", nodeId);
}

/** Home's menu item id. A constant: Home is one leaf and belongs to no module. */
export const HOME_MENU_ITEM_ID = "home";

/**
 * Menu items that outlived the navigation node they were derived from.
 *
 * **The only hand-written entries in this file, and they are a debt, not a pattern.**
 * Everything else here is derived precisely so there is no list to remember to
 * update; these three exist because a menu item id is permanent once shipped
 * (see `src/lib/menu-items/types.ts`) and three nav nodes were retired after shipping.
 *
 * Security, System Log and Message Queue were three Administration screens until they
 * were folded into the three tabs of System Messages. `ADMIN_TREE_MODULE.sections`
 * now yields one node where it yielded three, so the derived loop above no longer
 * emits `admin_section_security`, `admin_section_system_log` or
 * `admin_section_messages` — and a personal toolbar row saved against any of them
 * would address an item that no longer exists, losing both the row and whatever icon
 * was uploaded for its slot.
 *
 * So they are re-emitted here, pointing at the tab that replaced each screen. They
 * are **not** in `adminNav`, so they draw no second entry in the tree or the section
 * panel; they only exist for the picker and for rows that already reference them.
 *
 * `group` is deliberately omitted: these are not part of any heading in the nav, and
 * giving them one would file them under a group the tree does not draw.
 *
 * Nothing should be added to this list for a *new* screen. An entry earns its place
 * here only by having shipped as a nav node first.
 */
const RETIRED_ADMIN_MENU_ITEMS: {
  nodeId: string;
  title: string;
  hint: string;
  href: string;
  icon: string;
}[] = [
  {
    nodeId: "security",
    title: "Security",
    hint: "Sign-in history and failed login attempts",
    href: "/admin/system-messages?tab=security",
    icon: "shield",
  },
  {
    nodeId: "system-log",
    title: "System Log",
    hint: "What the application has been doing — DEBUG and OPERATIONAL lines",
    href: "/admin/system-messages?tab=system-log",
    icon: "list",
  },
  {
    nodeId: "messages",
    title: "Message Queue",
    hint: "Read the application-wide message queue, and delete messages from it",
    href: "/admin/system-messages?tab=messages",
    icon: "bell",
  },
];

/**
 * Every menu item, in navigation order: Home, then each module's sections, then
 * Administration's screens.
 *
 * `modules` is the **full** module list, not one reader's accessible subset. This
 * registry answers "what destinations exist in this app", which is an administrative
 * question — the admin screen must be able to retitle a section of a module the
 * current admin happens not to have been granted. Access filtering belongs at the
 * point of *rendering* a toolbar, not here, the same split `getAccessibleModules`
 * already owns for the tree.
 */
export function buildMenuItemSeeds(
  modules: { slug: string; shortName: string }[],
): MenuItemSeed[] {
  const seeds: MenuItemSeed[] = [
    {
      id: HOME_MENU_ITEM_ID,
      kind: "home",
      defaultTitle: HOME_SECTION.label,
      defaultHint: HOME_SECTION.hint,
      // No `moduleSlug` — Home deliberately belongs to no module, so it is offered
      // on its own in the picker rather than filed under one.
      moduleName: "Home",
      href: HOME_SECTION.href,
      icon: HOME_SECTION.icon,
    },
  ];

  for (const appModule of modules) {
    for (const section of moduleSectionSource.sectionsFor(appModule.slug)) {
      seeds.push({
        id: moduleMenuItemId(appModule.slug, section.id),
        kind: "module-section",
        defaultTitle: section.label,
        defaultHint: section.hint,
        moduleSlug: appModule.slug,
        moduleName: appModule.shortName,
        href: section.href,
        group: section.group,
        icon: section.icon,
      });
    }
  }

  for (const section of ADMIN_TREE_MODULE.sections) {
    seeds.push({
      id: adminMenuItemId(section.id),
      kind: "admin",
      defaultTitle: section.label,
      defaultHint: section.hint,
      // `admin` is not a `sys_modules` slug — Administration has no module row. It is
      // still the owning "module" for grouping, which is why `MenuItem.moduleSlug` is
      // documented as a slug *or* `"admin"`.
      moduleSlug: "admin",
      moduleName: ADMIN_TREE_MODULE.name,
      href: section.href,
      group: section.group,
      icon: section.icon,
    });
  }

  for (const alias of RETIRED_ADMIN_MENU_ITEMS) {
    seeds.push({
      id: adminMenuItemId(alias.nodeId),
      kind: "admin",
      defaultTitle: alias.title,
      defaultHint: alias.hint,
      moduleSlug: "admin",
      moduleName: ADMIN_TREE_MODULE.name,
      href: alias.href,
      icon: alias.icon,
    });
  }

  return seeds;
}

/**
 * The app's menu item source, for `listMenuItems`.
 *
 * Takes the module list rather than reading it, so the caller's single
 * `listModules(deps.moduleRepo)` serves both this and whatever else it was already
 * fetching — and so this file stays free of `deps`, which is what lets the CLI build
 * a source over a different database.
 */
export function createMenuItemSource(
  modules: { slug: string; shortName: string }[],
): MenuItemSource {
  return { listSeeds: () => buildMenuItemSeeds(modules) };
}
