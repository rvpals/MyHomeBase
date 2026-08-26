import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { listAllModuleSettings } from "@/lib/module-settings";
import { listModules } from "@/lib/modules";
import { listSettings } from "@/lib/settings";
import { getAccessibleModules, isAdmin } from "@/lib/user";
import { VIEWPORT_PINNED_COOKIE } from "@/lib/viewport";
import { deps } from "@/lib/wiring";
import { logoutAction } from "../../login/actions";
import { AdminShell } from "./admin-shell";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser || !isAdmin(currentUser)) redirect("/");

  const modules = listModules(deps.moduleRepo, { includeHidden: true });
  const settings = listSettings(deps.settingsRepo);
  const moduleSettings = listAllModuleSettings(deps.moduleSettingsRepo);

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

  return (
    <AdminShell
      initialModules={modules}
      initialSettings={settings}
      initialModuleSettings={moduleSettings}
      railLinks={railLinks}
      currentUser={{
        id: currentUser.id,
        fullName: currentUser.fullName,
        avatarMimeType: currentUser.avatarMimeType,
        updatedAt: currentUser.updatedAt,
      }}
      logoutAction={logoutAction}
      viewportPinned={cookieStore.get(VIEWPORT_PINNED_COOKIE)?.value === "1"}
    >
      {children}
    </AdminShell>
  );
}
