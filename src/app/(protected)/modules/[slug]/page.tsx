import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getModuleBySlug, getModuleCode } from "@/lib/modules";
import { userHasModuleAccess } from "@/lib/user";
import { deps } from "@/lib/wiring";

export default async function ModulePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const appModule = getModuleBySlug(deps.moduleRepo, slug);

  if (!appModule) notFound();

  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  // The (protected) layout already guarantees a logged-in user by this point;
  // this only guards against navigating straight to an unassigned module's URL.
  if (!currentUser || !userHasModuleAccess(currentUser, appModule.id, deps.userRepo)) notFound();

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
