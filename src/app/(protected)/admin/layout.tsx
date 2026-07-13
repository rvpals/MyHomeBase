import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { listAllModuleSettings } from "@/lib/module-settings";
import { listModules } from "@/lib/modules";
import { listSettings } from "@/lib/settings";
import { isAdmin } from "@/lib/user";
import { deps } from "@/lib/wiring";
import { AdminShell } from "./admin-shell";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser || !isAdmin(currentUser)) redirect("/");

  const modules = listModules(deps.moduleRepo, { includeHidden: true });
  const settings = listSettings(deps.settingsRepo);
  const moduleSettings = listAllModuleSettings(deps.moduleSettingsRepo);

  return (
    <AdminShell
      initialModules={modules}
      initialSettings={settings}
      initialModuleSettings={moduleSettings}
    >
      {children}
    </AdminShell>
  );
}
