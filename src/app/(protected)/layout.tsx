import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getModuleCode, listModules } from "@/lib/modules";
import { getSetting } from "@/lib/settings";
import { getAccessibleModules, isAdmin } from "@/lib/user";
import { deps } from "@/lib/wiring";
import { logoutAction } from "../login/actions";

function getAppName(): string {
  return getSetting(deps.settingsRepo, "application_name")?.value ?? "MyHomeBase";
}

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) redirect("/login");

  const appName = getAppName();
  const allModules = listModules(deps.moduleRepo);
  const accessibleModules = getAccessibleModules(currentUser, allModules, deps.userRepo);
  const links = accessibleModules.map((appModule) => ({
    slug: appModule.slug,
    name: appModule.shortName,
    href: `/modules/${appModule.slug}`,
    code: getModuleCode(appModule.slug),
    icon: appModule.icon,
    hint: appModule.description,
  }));

  return (
    <div className="flex min-h-screen">
      <Sidebar
        links={links}
        appName={appName}
        currentUser={{
          id: currentUser.id,
          fullName: currentUser.fullName,
          avatarMimeType: currentUser.avatarMimeType,
          updatedAt: currentUser.updatedAt,
        }}
        showAdmin={isAdmin(currentUser)}
        logoutAction={logoutAction}
      />
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
