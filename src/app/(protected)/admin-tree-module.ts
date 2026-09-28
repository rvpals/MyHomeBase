// Administration as a heading in the navigation tree.
//
// Administration is not a module: it has no `sys_modules` row, so
// `buildNavigationTree` cannot produce it from the module list the way it produces
// the other ten. It is still a destination with sections, and on the full layout it
// belongs in the same column as everything else — so it is declared here and
// appended by `NavTree`.
//
// **Derived from `adminNav`, never re-typed.** That list is the one already driving
// the section panel, and a second hand-written copy of Administration's screens
// would drift the first time someone added a page to one and not the other.

import type { SectionNode } from "@/components/section-panel";
import type { TreeModule, TreeSection } from "@/lib/navigation";
import { adminNav } from "./admin/nav";

/**
 * Flattens `adminNav`'s accordion groups into leaves carrying their heading as a
 * `group` label, plus the heading's own href and icon.
 *
 * Flat rather than nested because `TreeSection` is flat: a run of adjacent sections
 * sharing a `group` *is* the group, and `NavTree` draws that run as a nested box.
 * `flatMap` preserves `adminNav`'s order, so each group's children stay adjacent and
 * every group draws as exactly one box.
 *
 * `groupHref` is the heading's own page when it has one — only Daily Quote does;
 * Configuration and Display Settings are pure headings with no route, so their
 * children get `undefined` and their boxes render an unclickable header.
 *
 * A node with no `href` and no children is dropped: `adminNav` uses hrefless nodes
 * as pure headings, and one with nothing under it would be a label with no rows.
 */
export function flattenAdminNav(nodes: SectionNode[]): TreeSection[] {
  return nodes.flatMap((node): TreeSection[] => {
    const children = node.children ?? [];
    if (children.length > 0) {
      return children
        .filter((child) => child.href)
        .map((child) => ({
          id: child.id,
          label: child.label,
          href: child.href!,
          hint: child.hint,
          icon: child.icon,
          group: node.label,
          groupHref: node.href,
          groupIcon: node.icon,
        }));
    }
    if (!node.href) return [];
    return [
      { id: node.id, label: node.label, href: node.href, hint: node.hint, icon: node.icon },
    ];
  });
}

/**
 * The Administration heading. `icon: "shield"` matches the `chrome_admin_identity`
 * slot's default concept, so the tree's heading and the breadcrumb badge agree
 * without the tree having to resolve a slot for a module glyph.
 */
export const ADMIN_TREE_MODULE: TreeModule = {
  slug: "admin",
  name: "Administration",
  href: "/admin",
  icon: "shield",
  hint: "Users, modules, appearance and diagnostics.",
  sections: flattenAdminNav(adminNav),
};
