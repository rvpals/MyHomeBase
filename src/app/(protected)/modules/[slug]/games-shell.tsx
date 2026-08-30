// Games on the two-tier shell.
//
// A server component, so it can read `deps` for the things the shell needs and that
// only the server knows: the module list the reader can actually reach, the current
// user, and whether they're an admin. Mirrors `csv-shell.tsx`; the only differences
// are the slug and the section list.

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
  GAMES_SECTIONS,
  GAMES_SECTION_ICONS,
  GAMES_SECTION_INFO,
  gamesSectionHref,
} from "./games-sections";

const GAMES_MODULE_SLUG = "games";

export async function GamesShell({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  // The layout above already redirected an unauthenticated reader, so this is a type
  // narrowing rather than a real branch — but rendering the shell with no user would
  // crash on `currentUser.fullName`, so it's checked rather than asserted away.
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
  const appModule = getModuleBySlug(deps.moduleRepo, GAMES_MODULE_SLUG);

  const sections: SectionNode[] = GAMES_SECTIONS.map((section) => ({
    id: section,
    label: GAMES_SECTION_INFO[section].label,
    href: gamesSectionHref(section),
    hint: GAMES_SECTION_INFO[section].description,
    icon: GAMES_SECTION_ICONS[section],
  }));

  return (
    <TwoTierShell
      links={links}
      sections={sections}
      // Wires the three `games_section_*` icon slots: SectionPanel derives each id as
      // `games_section_<id>`, so there is nothing per-section to pass here.
      iconNamespace="games"
      module={{
        name: appModule?.shortName ?? "Games",
        icon: appModule?.icon ?? "game",
        href: `/modules/${GAMES_MODULE_SLUG}`,
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
