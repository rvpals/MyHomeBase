// Administration -> Display Settings -> Menu Items.
//
// A server component, mirroring the Floating Components screen beside it: it resolves
// the whole menu item registry up front so the rows start on their real values with no
// fetch-then-populate flicker.
//
// This screen retitles a *destination*. It does not decide which destinations exist —
// that is the section files, which are code — and it does not set an icon, which is
// Display Settings -> Icons and has always been able to, because a menu item's id IS
// its icon slot id. The two screens address the same positions by the same ids.

import { listMenuItems } from "@/lib/menu-items";
import { listModules } from "@/lib/modules";
import { deps } from "@/lib/wiring";
import { createMenuItemSource } from "../../../menu-item-source";
import { PAGE_CONTAINER } from "../../../page-container";
import { MenuItemsView } from "./view";

export default function MenuItemsPage() {
  // `includeHidden` so a hidden module's sections can still be retitled: hiding a
  // module is a visibility decision for readers, not a reason an admin should lose
  // the ability to name its screens.
  const modules = listModules(deps.moduleRepo, { includeHidden: true });
  const items = listMenuItems(createMenuItemSource(modules), deps.menuItemOverrideRepo);

  return (
    <div className={PAGE_CONTAINER}>
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
        Display Settings
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Menu Items</h1>
      <p className="mt-2 text-sm text-muted">
        Every screen the application can reach, with the name and description the
        navigation shows for it. Rename one here and it changes everywhere — the
        navigation tree, the breadcrumb and the section bar all read these. Each item&apos;s
        icon is set on the Icons screen, which addresses the same positions by the same
        ids.
      </p>

      <MenuItemsView items={items} />
    </div>
  );
}
