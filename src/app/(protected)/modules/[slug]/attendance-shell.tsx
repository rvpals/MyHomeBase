// Attendance on the two-tier shell — the third module migrated off `TreeNav`.
//
// A server component, so it can read `deps` for the things the shell needs and
// that only the server knows: the module list the reader can actually reach, the
// current user, and whether they're an admin. Mirrors `stock-shell.tsx` and
// `journal-shell.tsx`; the only differences are the slug and the section list.

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
  ATTENDANCE_SECTIONS,
  ATTENDANCE_SECTION_ICONS,
  ATTENDANCE_SECTION_INFO,
  attendanceSectionHref,
} from "./attendance-sections";

const ATTENDANCE_MODULE_SLUG = "attendance";

export async function AttendanceShell({ children }: { children: ReactNode }) {
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
  const appModule = getModuleBySlug(deps.moduleRepo, ATTENDANCE_MODULE_SLUG);

  const sections: SectionNode[] = ATTENDANCE_SECTIONS.map((section) => ({
    id: section,
    label: ATTENDANCE_SECTION_INFO[section].label,
    href: attendanceSectionHref(section),
    hint: ATTENDANCE_SECTION_INFO[section].description,
    icon: ATTENDANCE_SECTION_ICONS[section],
  }));

  return (
    <TwoTierShell
      links={links}
      sections={sections}
      iconNamespace="attendance"
      module={{
        name: appModule?.shortName ?? "Attendance",
        icon: appModule?.icon ?? "roster",
        href: `/modules/${ATTENDANCE_MODULE_SLUG}`,
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
