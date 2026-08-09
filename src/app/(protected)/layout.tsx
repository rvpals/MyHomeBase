import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppChrome } from "@/components/app-chrome";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { VIEWPORT_PINNED_COOKIE } from "@/lib/viewport";
import { getModuleCode, listModules } from "@/lib/modules";
import { getSetting } from "@/lib/settings";
import { getAccessibleModules, isAdmin } from "@/lib/user";
import { deps } from "@/lib/wiring";
import { logoutAction } from "../login/actions";

function getAppName(): string {
  return getSetting(deps.settingsRepo, "application_name")?.value ?? "MyHomeBase";
}

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) redirect("/login");

  const viewportPinned = cookieStore.get(VIEWPORT_PINNED_COOKIE)?.value === "1";

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

  // Both bars are `fixed`, so they're out of the flow and content gets the full
  // width. `app-main` is the hook globals.css uses to pad for whichever bars are
  // showing — this stays a server component, so reacting to that client-side
  // state has to happen in CSS.
  return (
    <div className="min-h-screen">
      <AppChrome
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
        viewportPinned={viewportPinned}
      />
      {/* No `px-*` here — `.app-main` sets the side gutter from `--app-gutter`,
          so the compact section-tree bar can cancel exactly that much and run
          edge to edge. */}
      <main className="app-main min-h-screen pb-8">{children}</main>
    </div>
  );
}
