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

  // The Sidebar is `fixed`, so it's out of the flow: `main` reserves only the
  // *collapsed* rail (4rem) plus a gutter, and an expanded sidebar floats over
  // the content instead of squeezing it. That's what gives a module the full
  // width of the screen — see src/components/sidebar.tsx.
  return (
    <div className="min-h-screen">
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
      {/* pl-24 = the 4rem rail + a 2rem gutter, so content clears the raised edge. */}
      <main className="min-h-screen py-8 pl-24 pr-8">{children}</main>
    </div>
  );
}
