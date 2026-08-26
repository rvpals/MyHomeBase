// Stocks & ETFs on the two-tier shell — the first module migrated off `TreeNav`.
//
// A server component, so it can read `deps` for the things the shell needs and
// that only the server knows: the module list the reader can actually reach, the
// current user, and whether they're an admin. `(protected)/layout.tsx` loads the
// same data for `AppChrome`; it's loaded again here rather than threaded down
// through the page tree, because every screen in between is a server component
// and passing it through all of them to reach one module is worse than a second
// cheap read of the module table.
//
// Everything client-side lives in `TwoTierShell`. This file only maps the
// module's own section list into the shape the shell takes.

import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { TwoTierShell } from "@/components/two-tier-shell";
import type { SectionNode } from "@/components/section-panel";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getModuleBySlug, listModules } from "@/lib/modules";
import { getAccessibleModules, isAdmin } from "@/lib/user";
import { VIEWPORT_PINNED_COOKIE } from "@/lib/viewport";
import { deps } from "@/lib/wiring";
import { logoutAction } from "../../../login/actions";
import {
  STOCK_SECTIONS,
  STOCK_SECTION_ICONS,
  STOCK_SECTION_INFO,
  stockSectionHref,
} from "./stock-sections";

const STOCK_ETFS_MODULE_SLUG = "stock-etfs";

export async function StockShell({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  // The layout above already redirected an unauthenticated reader, so this is a
  // type narrowing rather than a real branch — but rendering the shell with no
  // user would crash on `currentUser.fullName`, so it's checked rather than
  // asserted away.
  if (!currentUser) return <>{children}</>;

  const viewportPinned = cookieStore.get(VIEWPORT_PINNED_COOKIE)?.value === "1";

  const accessibleModules = getAccessibleModules(
    currentUser,
    listModules(deps.moduleRepo),
    deps.userRepo,
  );
  const links = accessibleModules.map((appModule) => ({
    slug: appModule.slug,
    name: appModule.shortName,
    href: `/modules/${appModule.slug}`,
    icon: appModule.icon,
    hint: appModule.description,
  }));

  // Both fields are admin-editable, so they're read rather than hardcoded.
  const appModule = getModuleBySlug(deps.moduleRepo, STOCK_ETFS_MODULE_SLUG);

  // Flat, as the module's sections already are. The panel supports one level of
  // nesting (`children`) if a future section needs grouping; nothing here does,
  // so nothing here declares it.
  const sections: SectionNode[] = STOCK_SECTIONS.map((section) => ({
    id: section,
    label: STOCK_SECTION_INFO[section].label,
    href: stockSectionHref(section),
    hint: STOCK_SECTION_INFO[section].description,
    icon: STOCK_SECTION_ICONS[section],
  }));

  return (
    <TwoTierShell
      links={links}
      sections={sections}
      module={{
        name: appModule?.shortName ?? "Stocks & ETFs",
        icon: appModule?.icon ?? "chart",
        href: `/modules/${STOCK_ETFS_MODULE_SLUG}`,
      }}
      currentUser={{
        id: currentUser.id,
        fullName: currentUser.fullName,
        avatarMimeType: currentUser.avatarMimeType,
        updatedAt: currentUser.updatedAt,
      }}
      showAdmin={isAdmin(currentUser)}
      logoutAction={logoutAction}
      viewportPinned={viewportPinned}
    >
      {children}
    </TwoTierShell>
  );
}
