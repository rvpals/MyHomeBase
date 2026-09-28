// Music Library on the two-tier shell — the last module off `TreeNav`.
//
// A server component, so it can read `deps` for the things the shell needs and
// that only the server knows: the module list the reader can actually reach, the
// current user, and whether they're an admin. Mirrors `stock-shell.tsx`; the
// only differences are the slug and the section list.

import { cookies } from "next/headers";
import type { CSSProperties, ReactNode } from "react";
import { TwoTierShell } from "@/components/two-tier-shell";
import type { SectionNode } from "@/components/section-panel";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { moduleTextureLibraryId, resolveAppTexture } from "@/lib/app-texture";
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
  MUSIC_SECTIONS,
  MUSIC_SECTION_ICONS,
  MUSIC_SECTION_INFO,
  musicSectionHref,
} from "./music-sections";

const MUSIC_LIBRARY_SLUG = "music-library";

export async function MusicShell({ children }: { children: ReactNode }) {
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
  const appModule = getModuleBySlug(deps.moduleRepo, MUSIC_LIBRARY_SLUG);

  // This module's optional background picture (migrations/0064, 0116).
  //
  // Resolved through `resolveAppTexture` rather than read directly, so this
  // shell and the layout agree on precedence by construction: this module's own
  // picture wins when it has one, and otherwise the app-wide selection is what
  // shows — which the layout has already drawn, so `source` is what tells this
  // wrapper whether it has anything of its own to add.
  //
  // Cheap: the settings row carries `hasImage`, never the bytes. `getDashboardTexture`
  // is a second cheap read of a pinned row, needed because "does the app-wide
  // layer exist behind me?" is what decides whether this wrapper must cancel it.
  const moduleTexture = getModuleTexture(deps.moduleTextureRepo, MUSIC_LIBRARY_SLUG);
  const libraryId = moduleTextureLibraryId(moduleTexture);
  const texture = resolveAppTexture(
    getDashboardTexture(deps.dashboardTextureRepo),
    moduleTexture,
    libraryId === undefined
      ? undefined
      : getDashboardTextureById(deps.dashboardTextureRepo, libraryId),
  );
  const textureVars = texture.source === "module" ? texture.vars : undefined;
  // `none` emits no picture but must still cancel the layout's layer — see the
  // wrapper below.
  const suppressesAppTexture = texture.source === "module" || moduleTexture.source === "none";

  const sections: SectionNode[] = MUSIC_SECTIONS.map((section) => ({
    id: section,
    label: MUSIC_SECTION_INFO[section].label,
    href: musicSectionHref(section),
    hint: MUSIC_SECTION_INFO[section].description,
    icon: MUSIC_SECTION_ICONS[section],
  }));

  return (
    <TwoTierShell
      links={links}
      sections={sections}
      iconNamespace="music"
      module={{
        name: appModule?.shortName ?? "Music Library",
        icon: appModule?.icon ?? "music",
        href: `/modules/${MUSIC_LIBRARY_SLUG}`,
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
          keeping the rail and the section panel outside means the module's own
          chrome stays on the theme's flat surfaces and legible at any opacity.
          The attribute is absent when this module has no picture of its own, so
          this is a bare wrapper div in that case — and the app-wide layer the
          layout drew shows through, which is exactly what should happen.

          When the module DOES have its own picture, `textureVars` sets the
          `--app-texture-*` properties on this div. Because custom properties
          inherit, that overrides the values the layout set on `.app-main` for
          this subtree — but the layout's own `::before` sits on `.app-main` and
          already resolved them, so it keeps drawing the app-wide picture behind
          this one. `data-app-texture-override` here is what turns that off; the
          layout can't decide it (it doesn't know which module is rendering), so
          the module announces itself and the ancestor stands down —
          see `[data-app-texture]:has([data-app-texture-override])` in
          globals.css. */}
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
