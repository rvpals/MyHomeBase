// Picture Gallery on the two-tier shell.
//
// A server component, so it can read `deps` for the things the shell needs and
// that only the server knows: the module list the reader can actually reach, the
// current user, and whether they're an admin. Mirrors `csv-shell.tsx`; the only
// differences are the slug and the section list.

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
  GALLERY_SECTIONS,
  GALLERY_SECTION_ICONS,
  GALLERY_SECTION_INFO,
  gallerySectionHref,
} from "./gallery-sections";

const PICTURE_GALLERY_MODULE_SLUG = "picture-gallery";

export async function GalleryShell({ children }: { children: ReactNode }) {
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
  const appModule = getModuleBySlug(deps.moduleRepo, PICTURE_GALLERY_MODULE_SLUG);

  const sections: SectionNode[] = GALLERY_SECTIONS.map((section) => ({
    id: section,
    label: GALLERY_SECTION_INFO[section].label,
    href: gallerySectionHref(section),
    hint: GALLERY_SECTION_INFO[section].description,
    icon: GALLERY_SECTION_ICONS[section],
  }));

  return (
    <TwoTierShell
      links={links}
      sections={sections}
      // `gallery`, not the slug: `sectionSlotId` snake-cases the SECTION slug but
      // leaves the namespace as given, so a hyphenated one would derive
      // `picture-gallery_section_main` -- an id that matches no slot and would
      // silently never pick up an override. Every other module's namespace is one
      // word for the same reason. Asserted in src/lib/icons/slots.test.ts.
      iconNamespace="gallery"
      module={{
        name: appModule?.shortName ?? "Picture Gallery",
        icon: appModule?.icon ?? "photo",
        href: `/modules/${PICTURE_GALLERY_MODULE_SLUG}`,
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
