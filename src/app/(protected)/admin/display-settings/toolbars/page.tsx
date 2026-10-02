// Administration -> Display Settings -> Personal Toolbars.
//
// A server component, like the Floating Components and Menu Items screens beside
// it: it loads the toolbars and the whole menu item catalogue up front, so the
// builder's module and screen pickers are populated with no fetch-then-populate
// flicker.
//
// **A toolbar is additive.** It never replaces the navigation tree or the compact
// bottom bar — this screen adds shortcut bars beside them, and an admin who creates
// none changes nothing about the app.

import { listMenuItems } from "@/lib/menu-items";
import { listModules } from "@/lib/modules";
import { listToolbars } from "@/lib/toolbars";
import { deps } from "@/lib/wiring";
import { createMenuItemSource } from "../../../menu-item-source";
import { PAGE_CONTAINER } from "../../../page-container";
import { ToolbarsView } from "./view";

/**
 * `?edit=<id>` opens straight into one toolbar's editor.
 *
 * What the ✎ button on a rendered toolbar links to, so "change this bar" is one
 * click from the bar itself rather than a trip through the list. In the URL rather
 * than in client state so the result is a real address — bookmarkable, shareable,
 * and surviving a refresh or the back button. Same reasoning as the Journal's
 * `?filter=` and Expense's group links.
 *
 * An id naming no toolbar is ignored rather than erroring: the bar it came from may
 * have been deleted in another tab, and the list is the right place to land then.
 */
export default async function ToolbarsPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const { edit } = await searchParams;
  const requestedId = Number(edit);

  // `includeHidden`, matching the Menu Items screen: a hidden module's sections are
  // still real destinations, and an admin building a bar may legitimately point at
  // one they are about to unhide.
  const modules = listModules(deps.moduleRepo, { includeHidden: true });
  const menuItems = listMenuItems(createMenuItemSource(modules), deps.menuItemOverrideRepo);
  const toolbars = listToolbars(deps.toolbarRepo);
  const editToolbarId =
    Number.isInteger(requestedId) && toolbars.some((toolbar) => toolbar.id === requestedId)
      ? requestedId
      : undefined;

  return (
    <div className={PAGE_CONTAINER}>
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
        Display Settings
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Personal Toolbars</h1>
      <p className="mt-2 text-sm text-muted">
        A toolbar is a strip of shortcuts docked to one edge of the screen. It sits
        <em> beside </em>
        the normal navigation rather than replacing it — the navigation tree and the
        bottom bar are unchanged, so nothing is lost by hiding a toolbar. Each person
        chooses which of these to show on their own screen, from their Account page.
      </p>

      <ToolbarsView
        toolbars={toolbars}
        menuItems={menuItems}
        editToolbarId={editToolbarId}
      />
    </div>
  );
}
