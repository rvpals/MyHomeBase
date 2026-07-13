import Link from "next/link";
import { AdminIcon } from "@/components/admin-icon";
import { AppIcon } from "@/components/app-icon";
import { ModuleCard } from "@/components/module-card";
import { getModuleCode, listModules } from "@/lib/modules";
import { getSetting } from "@/lib/settings";
import { deps } from "@/lib/wiring";

export default function Home() {
  const modules = listModules(deps.moduleRepo);
  const appName = getSetting(deps.settingsRepo, "application_name")?.value ?? "MyHomeBase";

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center justify-center gap-4">
        <AppIcon className="h-14 w-14 shrink-0" />
        <h1 className="font-display text-3xl font-semibold text-ink">{appName}</h1>
        {/* One-off 3D button — not registered in components.md; promote if a second CTA needs this style. */}
        <Link
          href="/admin"
          className="inline-flex shrink-0 items-center gap-2 rounded-full bg-brass px-4 py-2 text-sm font-semibold text-white shadow-[0_5px_0_0_var(--brass-dark),0_16px_28px_-8px_rgba(0,0,0,0.45),0_6px_12px_-4px_rgba(0,0,0,0.3)] transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[0_5px_0_0_var(--brass-dark),0_22px_36px_-8px_rgba(0,0,0,0.5),0_10px_16px_-4px_rgba(0,0,0,0.35)] hover:brightness-105 active:translate-y-1 active:shadow-[0_0px_0_0_var(--brass-dark),0_4px_8px_-4px_rgba(0,0,0,0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass focus-visible:ring-offset-2 focus-visible:ring-offset-paper motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:translate-y-0"
        >
          <AdminIcon className="h-4 w-4" />
          Administration
        </Link>
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
