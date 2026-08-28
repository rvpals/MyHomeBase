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
import { getModuleTexture, moduleTextureCssVars } from "@/lib/module-texture";
import { getModuleBySlug, listModules } from "@/lib/modules";
import { getAccessibleModules, isAdmin } from "@/lib/user";
import { VIEWPORT_PINNED_COOKIE } from "@/lib/viewport";
import { deps } from "@/lib/wiring";
import { logoutAction } from "../../../login/actions";
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

  // Both fields are admin-editable, so they're read rather than hardcoded.
  const appModule = getModuleBySlug(deps.moduleRepo, MUSIC_LIBRARY_SLUG);

  // This module's optional background picture (migrations/0064). `undefined` when
  // nothing has been uploaded, which keeps the fixed texture layer out of the DOM
  // entirely rather than rendering one at opacity 0 — see globals.css,
  // `[data-module-texture]`. Cheap: the settings row carries `hasImage`, never
  // the bytes.
  const textureVars = moduleTextureCssVars(
    getModuleTexture(deps.moduleTextureRepo, MUSIC_LIBRARY_SLUG),
  );

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
      logoutAction={logoutAction}
      viewportPinned={viewportPinned}
    >
      {/* The texture wrapper goes inside the shell, around the section content
          only: its `::before` is `fixed` so it still covers the viewport, but
          keeping the rail and the section panel outside means the module's own
          chrome stays on the theme's flat surfaces and legible at any opacity.
          The attribute is absent when nothing was uploaded, so this is a bare
          wrapper div in that case. */}
      <div
        data-module-texture={textureVars ? "" : undefined}
        style={textureVars as CSSProperties | undefined}
      >
        {children}
      </div>
    </TwoTierShell>
  );
}
