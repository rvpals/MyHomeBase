// My Journal on the two-tier shell — the second module migrated off `TreeNav`.
//
// A server component, so it can read `deps` for the things the shell needs and
// that only the server knows: the module list the reader can actually reach, the
// current user, and whether they're an admin. Mirrors `stock-shell.tsx`; the
// only differences are the slug and the section list.

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
  JOURNAL_CONFIGURATION_SECTIONS,
  JOURNAL_SECTIONS,
  JOURNAL_SECTION_ICONS,
  JOURNAL_SECTION_INFO,
  journalSectionHref,
  type JournalSection,
} from "./journal-sections";

const JOURNAL_MODULE_SLUG = "journal";

export async function JournalShell({ children }: { children: ReactNode }) {
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
  const appModule = getModuleBySlug(deps.moduleRepo, JOURNAL_MODULE_SLUG);

  const toNode = (section: JournalSection): SectionNode => ({
    id: section,
    label: JOURNAL_SECTION_INFO[section].label,
    href: journalSectionHref(section),
    hint: JOURNAL_SECTION_INFO[section].description,
    icon: JOURNAL_SECTION_ICONS[section],
  });

  // One level of nesting: everything is flat except the Configuration group,
  // which collects Preferences (the long-standing /configuration route) and
  // Templates. The heading itself carries no `href` — `SectionPanel` renders a
  // node with children as an accordion label rather than a link, and drops it
  // from the compact sheet, so giving it one would be a route nothing reaches.
  const grouped = new Set<string>(JOURNAL_CONFIGURATION_SECTIONS);
  const sections: SectionNode[] = [
    ...JOURNAL_SECTIONS.filter((section) => !grouped.has(section)).map(toNode),
    {
      id: "configuration-group",
      label: "Configuration",
      hint: "How your journal works.",
      icon: "gear",
      children: JOURNAL_CONFIGURATION_SECTIONS.map(toNode),
    },
  ];

  return (
    <TwoTierShell
      links={links}
      sections={sections}
      module={{
        name: appModule?.shortName ?? "My Journal",
        icon: appModule?.icon ?? "journal",
        href: `/modules/${JOURNAL_MODULE_SLUG}`,
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
