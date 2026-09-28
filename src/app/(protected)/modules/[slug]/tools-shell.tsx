// Tools on the two-tier shell.
//
// A server component, so it can read `deps` for the things the shell needs and
// that only the server knows: the module list the reader can actually reach, the
// current user, and whether they're an admin. Mirrors `csv-shell.tsx`; the only
// differences are the slug and the section list.

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
  TOOLS_SECTIONS,
  TOOLS_SECTION_ICONS,
  TOOLS_SECTION_INFO,
  toolsSectionHref,
} from "./tools-sections";

const TOOLS_MODULE_SLUG = "tools";

export async function ToolsShell({ children }: { children: ReactNode }) {
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

  // The whole app's navigation, for the full layout's tree. Built here rather
  // than in the shell component because it reads the module list and this
  // reader's stored expanded set — both server-only.
  const navTree = getNavTreeData(currentUser);

  // Both fields are admin-editable, so they're read rather than hardcoded.
  const appModule = getModuleBySlug(deps.moduleRepo, TOOLS_MODULE_SLUG);

  const sections: SectionNode[] = TOOLS_SECTIONS.map((section) => ({
    id: section,
    label: TOOLS_SECTION_INFO[section].label,
    href: toolsSectionHref(section),
    hint: TOOLS_SECTION_INFO[section].description,
    icon: TOOLS_SECTION_ICONS[section],
  }));

  // This module's background (migrations 0064, 0116, 0117): its own upload, a
  // picture chosen from the app library, nothing, or — the default — the
  // app-wide texture that the protected layout already drew.
  //
  // All three reads are cheap: each derives `image IS NOT NULL` in SQL, so no
  // picture bytes reach this render. The library lookup happens only when this
  // module actually points at one.
  const moduleTexture = getModuleTexture(deps.moduleTextureRepo, TOOLS_MODULE_SLUG);
  const libraryId = moduleTextureLibraryId(moduleTexture);
  const texture = resolveAppTexture(
    getDashboardTexture(deps.dashboardTextureRepo),
    moduleTexture,
    libraryId === undefined
      ? undefined
      : getDashboardTextureById(deps.dashboardTextureRepo, libraryId),
  );
  // Only a choice of this module's own replaces what the layout drew. On
  // `inherit` the layout's layer shows through and this shell adds nothing; on
  // `none` the override attribute suppresses it and no picture is emitted.
  const textureVars = texture.source === "module" ? texture.vars : undefined;
  const suppressesAppTexture = texture.source === "module" || moduleTexture.source === "none";

  return (
    <TwoTierShell
      links={links}
      sections={sections}
      iconNamespace="tools"
      module={{
        name: appModule?.shortName ?? "Tools",
        icon: appModule?.icon ?? "tool",
        href: `/modules/${TOOLS_MODULE_SLUG}`,
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
      // The full layout's one navigation column. `sections` above still feeds
      // the compact bottom bar, which is unchanged.
      tree={navTree.tree}
      expandedModules={navTree.expandedModules}
      onExpandedChange={setExpandedModulesAction}
      adminTreeModule={navTree.adminTreeModule}
    >
      {/* The texture wrapper goes inside the shell, around the section content
          only: its `::before` is `fixed` so it still covers the viewport, but
          keeping the tree and the section panel outside means this module's own
          navigation chrome stays on flat theme surfaces at any opacity.

          `data-app-texture-override` is what stops the app-wide layer showing
          through — the shared layout can't know which module is rendering, so
          the module announces itself and the ancestor stands down. See
          `[data-app-texture]:has([data-app-texture-override])` in globals.css.
          It is set for `none` as well as for a picture: that mode means "plain
          paper here" and has to cancel the inherited layer while emitting none
          of its own. */}
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
