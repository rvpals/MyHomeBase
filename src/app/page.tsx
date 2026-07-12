import Link from "next/link";
import { AdminIcon } from "@/components/admin-icon";
import { ModuleCard } from "@/components/module-card";
import { getModuleCode, listModules } from "@/lib/modules";
import { getSetting } from "@/lib/settings";
import { deps } from "@/lib/wiring";

export default function Home() {
  const modules = listModules(deps.moduleRepo);
  const appName = getSetting(deps.settingsRepo, "application_name")?.value ?? "MyHomeBase";

  return (
    <div className="mx-auto max-w-5xl">
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
        Modules
      </p>
      <div className="mt-2 flex items-center justify-between gap-4">
        <h1 className="font-display text-3xl font-semibold text-ink">{appName}</h1>
        {/* One-off 3D button — not registered in components.md; promote if a second CTA needs this style. */}
        <Link
          href="/admin"
          className="inline-flex shrink-0 items-center gap-2 rounded-full bg-brass px-4 py-2 text-sm font-semibold text-white shadow-[0_4px_0_0_var(--brass-dark)] transition-transform duration-150 hover:brightness-105 active:translate-y-1 active:shadow-[0_0_0_0_var(--brass-dark)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass focus-visible:ring-offset-2 focus-visible:ring-offset-paper motion-reduce:transition-none motion-reduce:active:translate-y-0"
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
