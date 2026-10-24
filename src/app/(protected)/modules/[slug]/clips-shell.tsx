// Clips on the two-tier shell.
//
// A server component, so it can read `deps` for the things the shell needs and that
// only the server knows: the module list the reader can actually reach, the current
// user, and whether they're an admin. Mirrors `journal-shell.tsx`; the only
// differences are the slug and the section list.
//
// This module builds NO navigation of its own. Declaring `sections` feeds the
// compact bottom bar and the breadcrumb, the `SECTION_BUILDERS` entry in
// `module-sections.ts` feeds the desktop tree, and the four `tree`/`expandedModules`
// /`onExpandedChange`/`adminTreeModule` props below are copied from the journal's
// shell. Adding a bar of its own is the fastest way to break a phone layout here —
// the bottom edge is already claimed by the shared bar and the music player.

import { cookies } from "next/headers";
import type { CSSProperties, ReactNode } from "react";
import { TwoTierShell } from "@/components/two-tier-shell";
import type { SectionNode } from "@/components/section-panel";
import { moduleTextureLibraryId, resolveAppTexture } from "@/lib/app-texture";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getDashboardTexture, getDashboardTextureById } from "@/lib/dashboard-texture";
import { getModuleTexture } from "@/lib/module-texture";
import { getModuleBySlug, listModules } from "@/lib/modules";
import { getAccessibleModules, isAdmin } from "@/lib/user";
import { VIEWPORT_PINNED_COOKIE } from "@/lib/viewport";
import { deps } from "@/lib/wiring";
import { logoutAction } from "../../../login/actions";
import { getNavTreeData } from "../../nav-tree-data";
import { setExpandedModulesAction } from "../../nav-tree-actions";
import { MessageQueueHost } from "../../message-queue-host";
import {
  CLIPS_SECTIONS,
  CLIPS_SECTION_ICONS,
  CLIPS_SECTION_INFO,
  clipsSectionHref,
  type ClipsSection,
} from "./clips-sections";

const CLIPS_MODULE_SLUG = "clips";

export async function ClipsShell({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  // The layout above already redirected an unauthenticated reader, so this is a
  // type narrowing rather than a real branch — but rendering the shell with no user
  // would crash on `currentUser.fullName`, so it's checked rather than asserted away.
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

  const navTree = getNavTreeData(currentUser);

  // Both name fields are admin-editable, so they're read rather than hardcoded.
  const appModule = getModuleBySlug(deps.moduleRepo, CLIPS_MODULE_SLUG);

  // Flat: four sections is under the ~6 threshold `modules.md` sets for nesting, so
  // there are no group headings here and every node is a real destination.
  const sections: SectionNode[] = CLIPS_SECTIONS.map(
    (section: ClipsSection): SectionNode => ({
      id: section,
      label: CLIPS_SECTION_INFO[section].label,
      href: clipsSectionHref(section),
      hint: CLIPS_SECTION_INFO[section].description,
      icon: CLIPS_SECTION_ICONS[section],
    }),
  );

  // This module's background (migrations 0064, 0116, 0117): its own upload, a
  // picture chosen from the app library, nothing, or — the default — the app-wide
  // texture that the protected layout already drew. All three reads are cheap: each
  // derives `image IS NOT NULL` in SQL, so no picture bytes reach this render.
  const moduleTexture = getModuleTexture(deps.moduleTextureRepo, CLIPS_MODULE_SLUG);
  const libraryId = moduleTextureLibraryId(moduleTexture);
  const texture = resolveAppTexture(
    getDashboardTexture(deps.dashboardTextureRepo),
    moduleTexture,
    libraryId === undefined
      ? undefined
      : getDashboardTextureById(deps.dashboardTextureRepo, libraryId),
  );
  const textureVars = texture.source === "module" ? texture.vars : undefined;
  const suppressesAppTexture = texture.source === "module" || moduleTexture.source === "none";

  return (
    <TwoTierShell
      links={links}
      sections={sections}
      iconNamespace="clips"
      module={{
        name: appModule?.shortName ?? "Clips",
        icon: appModule?.icon ?? "folder",
        href: `/modules/${CLIPS_MODULE_SLUG}`,
        slug: CLIPS_MODULE_SLUG,
      }}
      currentUser={{
        id: currentUser.id,
        fullName: currentUser.fullName,
        avatarMimeType: currentUser.avatarMimeType,
        updatedAt: currentUser.updatedAt,
      }}
      showAdmin={isAdmin(currentUser)}
      headerActions={<MessageQueueHost />}
      logoutAction={logoutAction}
      viewportPinned={viewportPinned}
      // The full layout's one navigation column. `sections` above still feeds the
      // compact bottom bar, which is unchanged — see `TwoTierShell`'s `tree` prop.
      tree={navTree.tree}
      expandedModules={navTree.expandedModules}
      onExpandedChange={setExpandedModulesAction}
      adminTreeModule={navTree.adminTreeModule}
      navTexture={navTree.navTexture}
    >
      {/* The texture wrapper goes inside the shell, around the section content only:
          its `::before` is `fixed` so it still covers the viewport, but keeping the
          tree and the section panel outside means this module's own navigation
          chrome stays on flat theme surfaces at any opacity. */}
      <div
        data-app-texture={textureVars ? "" : undefined}
        data-app-texture-override={suppressesAppTexture ? "" : undefined}
        style={textureVars as CSSProperties | undefined}
      >
        {children}
      </div>
    </TwoTierShell>
  );
}
