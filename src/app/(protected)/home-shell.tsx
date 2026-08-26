// The two-tier shell for the screens that belong to no module: the home screen
// and the account screen.
//
// Both sit outside `modules/[slug]`, so neither has a module shell of its own —
// and when the old `AppChrome` top bar was retired they were left with no
// navigation at all: no way to switch modules, reach Administration or log out.
// This is their shell.
//
// Two tiers rather than three. There is no tier 2 here because there is no
// module to have sections: `TwoTierShell` treats an empty `sections` as "no
// panel", so the content column starts right after the 64px rail. The rail
// itself already carries the Home link, so the home screen is reachable from
// every page including this one.
//
// Mirrors the module shells (`journal-shell.tsx` and friends): a server
// component, reading `deps` for the module list, the current user and their
// admin status.

import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { TwoTierShell } from "@/components/two-tier-shell";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { listModules } from "@/lib/modules";
import { getAccessibleModules, isAdmin } from "@/lib/user";
import { VIEWPORT_PINNED_COOKIE } from "@/lib/viewport";
import { deps } from "@/lib/wiring";
import { logoutAction } from "../login/actions";

export async function HomeShell({
  label,
  icon,
  href,
  children,
}: {
  /** The breadcrumb's only crumb — "Home" or "My account". */
  label: string;
  /** A glyph from `ModuleIcon`'s set to badge the crumb with. */
  icon: string;
  /** Where the crumb points. It's the last crumb, so it renders unlinked. */
  href: string;
  children: ReactNode;
}) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  // The layout above already redirected an unauthenticated reader, so this is a
  // type narrowing rather than a real branch — but rendering the shell with no
  // user would crash on `currentUser.fullName`, so it's checked rather than
  // asserted away.
  if (!currentUser) return <>{children}</>;

  const accessibleModules = getAccessibleModules(
    currentUser,
    listModules(deps.moduleRepo),
    deps.userRepo,
  );

  return (
    <TwoTierShell
      links={accessibleModules.map((appModule) => ({
        slug: appModule.slug,
        name: appModule.shortName,
        href: `/modules/${appModule.slug}`,
        icon: appModule.icon,
        hint: appModule.description,
      }))}
      sections={[]}
      module={{ name: label, icon, href }}
      currentUser={{
        id: currentUser.id,
        fullName: currentUser.fullName,
        avatarMimeType: currentUser.avatarMimeType,
        updatedAt: currentUser.updatedAt,
      }}
      showAdmin={isAdmin(currentUser)}
      logoutAction={logoutAction}
      viewportPinned={cookieStore.get(VIEWPORT_PINNED_COOKIE)?.value === "1"}
    >
      {children}
    </TwoTierShell>
  );
}
