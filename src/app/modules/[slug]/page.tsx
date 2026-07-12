import { notFound } from "next/navigation";
import { getModuleBySlug, getModuleCode } from "@/lib/modules";
import { deps } from "@/lib/wiring";

export default async function ModulePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const appModule = getModuleBySlug(deps.moduleRepo, slug);

  if (!appModule) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
        {getModuleCode(appModule.slug)}
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">{appModule.longName}</h1>
      <div className="mt-3 h-px w-full bg-line" />
      <div className="mt-8 rounded-xl border border-dashed border-line p-8 text-center">
        <p className="font-display text-lg text-ink">Coming soon</p>
        <p className="mt-1 text-sm text-muted">This module hasn&apos;t been built out yet.</p>
      </div>
    </div>
  );
}
