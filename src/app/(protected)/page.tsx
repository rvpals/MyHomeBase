import { cookies } from "next/headers";
import { AdminIcon } from "@/components/admin-icon";
import { AppIcon } from "@/components/app-icon";
import { Button } from "@/components/button";
import { ModuleCard } from "@/components/module-card";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getModuleCode, listModules } from "@/lib/modules";
import { getSetting } from "@/lib/settings";
import { getAccessibleModules, isAdmin } from "@/lib/user";
import { deps } from "@/lib/wiring";

export default async function Home() {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  // The (protected) layout already guarantees currentUser is defined here.
  const allModules = listModules(deps.moduleRepo);
  const modules = currentUser ? getAccessibleModules(currentUser, allModules, deps.userRepo) : [];
  const appName = getSetting(deps.settingsRepo, "application_name")?.value ?? "MyHomeBase";

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center justify-center gap-4">
        <AppIcon className="h-14 w-14 shrink-0" />
        <h1 className="font-display text-3xl font-semibold text-ink">{appName}</h1>
        {currentUser && isAdmin(currentUser) && (
          <Button href="/admin" variant="primary">
            <AdminIcon className="h-4 w-4" />
            Administration
          </Button>
        )}
      </div>
      <div className="mt-3 h-px w-full bg-line" />
      <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map((appModule) => (
          <ModuleCard
            key={appModule.slug}
            name={appModule.longName}
            description={appModule.description}
            href={`/modules/${appModule.slug}`}
            code={getModuleCode(appModule.slug)}
            icon={appModule.icon}
          />
        ))}
      </div>
    </div>
  );
}
