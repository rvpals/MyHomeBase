import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { listDashboardTextures } from "@/lib/dashboard-texture";
import { listAllModuleSettings } from "@/lib/module-settings";
import { getModuleTexture } from "@/lib/module-texture";
import { listModules } from "@/lib/modules";
import { listSettings } from "@/lib/settings";
import { getAccessibleModules, isAdmin } from "@/lib/user";
import { VIEWPORT_PINNED_COOKIE } from "@/lib/viewport";
import { deps } from "@/lib/wiring";
import { logoutAction } from "../../login/actions";
import { MessageQueueHost } from "../message-queue-host";
import { getNavTreeData } from "../nav-tree-data";
import { setExpandedModulesAction } from "../nav-tree-actions";
import { AdminShell } from "./admin-shell";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser || !isAdmin(currentUser)) redirect("/");

  const modules = listModules(deps.moduleRepo, { includeHidden: true });
  const settings = listSettings(deps.settingsRepo);
  const moduleSettings = listAllModuleSettings(deps.moduleSettingsRepo);

  // The texture library and each module's current choice, for Module
  // Configuration's background picker (migration 0117). Read here for the same
  // reason `railLinks` is: `AdminShell` is a client component and cannot touch
  // `deps`.
  //
  // Cheap despite being per-module: every one of these reads is a primary-key
  // lookup that derives `image IS NOT NULL` in SQL, so no picture bytes are
  // materialised — and the library list never carries bytes either.
  const moduleTextures = listDashboardTextures(deps.dashboardTextureRepo);
  const moduleTextureChoices = Object.fromEntries(
    modules.map((appModule) => {
      const texture = getModuleTexture(deps.moduleTextureRepo, appModule.slug);
      return [
        appModule.slug,
        { source: texture.source, textureId: texture.textureId, hasOwnImage: texture.hasImage },
      ];
    }),
  );

  // The two-tier shell's own data. `AdminShell` is a client component and can't
  // read `deps` or `cookies()` itself, so unlike the module shells — which are
  // server components and load this for themselves — it arrives as props.
  //
  // `includeHidden` above is for the *admin table*; the rail must show only what
  // this reader can actually open, so it takes the accessible list instead.
  const railLinks = getAccessibleModules(
    currentUser,
    listModules(deps.moduleRepo),
    deps.userRepo,
  ).map((appModule) => ({
    slug: appModule.slug,
    name: appModule.shortName,
    href: `/modules/${appModule.slug}`,
    icon: appModule.icon,
    hint: appModule.description,
  }));

  // The full layout's navigation tree, loaded here for the same reason
  // `railLinks` is: `AdminShell` is a client component and can't read `deps`.
  const navTree = getNavTreeData(currentUser);

  return (
    <AdminShell
      initialModules={modules}
      initialSettings={settings}
      initialModuleSettings={moduleSettings}
      textureLibrary={moduleTextures}
      moduleTextureChoices={moduleTextureChoices}
      railLinks={railLinks}
      tree={navTree.tree}
      expandedModules={navTree.expandedModules}
      adminTreeModule={navTree.adminTreeModule}
      navTexture={navTree.navTexture}
      setExpandedModules={setExpandedModulesAction}
      currentUser={{
        id: currentUser.id,
        fullName: currentUser.fullName,
        avatarMimeType: currentUser.avatarMimeType,
        updatedAt: currentUser.updatedAt,
      }}
      headerActions={<MessageQueueHost />}
      logoutAction={logoutAction}
      viewportPinned={cookieStore.get(VIEWPORT_PINNED_COOKIE)?.value === "1"}
    >
      {children}
    </AdminShell>
  );
}
