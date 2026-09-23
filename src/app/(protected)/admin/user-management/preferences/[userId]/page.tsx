import Link from "next/link";
import { notFound } from "next/navigation";
import { getEnabledFloating } from "@/lib/floating";
import { listModules } from "@/lib/modules";
import { getAccessibleModules, getUserById } from "@/lib/user";
import { getUserPreferences } from "@/lib/user-preferences";
import { deps } from "@/lib/wiring";
import { AdminUserPreferencesView } from "./view";

/**
 * Administration > User Management > User Preferences.
 *
 * The **same screen** as My Account, pointed at another account. Reusing
 * `AccountView` rather than writing a second copy is the whole design: a preference
 * added to the Account screen appears here with no further work, and the two can't
 * drift into disagreeing about what a preference means.
 *
 * Guarded twice over, deliberately. The `/admin` layout redirects a non-admin who
 * renders this page; every action behind it calls `requireAdmin()` on its own, because
 * an action is its own POST endpoint that no layout runs before. Neither guard is
 * redundant — they cover different ways in.
 *
 * Reached from a row in the user list, not from `adminNav`: it is about one account,
 * and a per-user screen in a global menu would have nothing to point at.
 */
export default async function UserPreferencesPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId: rawUserId } = await params;

  // `Number` on a non-numeric segment is NaN, which would reach a `WHERE id = ?`
  // that matches nothing — so it is checked here and turned into a 404 rather than
  // an empty screen under nobody's name.
  const userId = Number(rawUserId);
  const target =
    Number.isInteger(userId) && userId > 0 ? getUserById(userId, deps.userRepo) : undefined;
  if (!target) notFound();

  // The *target's* accessible modules, not the admin's. An admin reaches everything,
  // so using their list here would offer favorites this user cannot open — and
  // `adminSavePreferencesAction` re-derives the same list server-side, so a stale
  // option would be refused on save anyway.
  const accessibleModules = getAccessibleModules(
    target,
    listModules(deps.moduleRepo),
    deps.userRepo,
  );

  return (
    <AdminUserPreferencesView
      target={target}
      preferences={getUserPreferences(deps.userPreferencesRepo, target.id)}
      // Read here rather than in the view: which components are available is an
      // app-wide setting, and the view is a client island.
      enabledFloating={getEnabledFloating(deps.settingsRepo)}
      // Plain data across the boundary, as the Account page does it.
      modules={accessibleModules.map((appModule) => ({
        slug: appModule.slug,
        name: appModule.longName,
        hasImage: appModule.hasCarouselImage,
        imageVersion: appModule.updatedAt,
      }))}
      banner={
        <Link
          href="/admin/user-management"
          className="text-xs font-medium text-brass-dark hover:underline"
        >
          &lsaquo; Back to User Management
        </Link>
      }
      intro={
        <p className="mt-3 text-sm text-muted">
          You are editing <span className="font-medium text-ink">{target.username}</span>
          &rsquo;s settings, exactly as they would see them on their own My Account screen.
          Changes take effect for them, not for you.
        </p>
      }
    />
  );
}
