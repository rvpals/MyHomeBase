import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { listModules } from "@/lib/modules";
import { getAccessibleModules } from "@/lib/user";
import { getUserPreferences } from "@/lib/user-preferences";
import {
  VIEWPORT_COOKIE,
  VIEWPORT_PINNED_COOKIE,
  resolveViewport,
} from "@/lib/viewport";
import { deps } from "@/lib/wiring";
import { AccountView } from "./view";

export default async function AccountPage() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) redirect("/login");

  // Only the modules this user can actually reach are offerable as a favorite —
  // otherwise the startup redirect could point somewhere they can't open.
  const accessibleModules = getAccessibleModules(
    currentUser,
    listModules(deps.moduleRepo),
    deps.userRepo,
  );

  return (
    <AccountView
      user={currentUser}
      viewport={resolveViewport({ cookieValue: cookieStore.get(VIEWPORT_COOKIE)?.value })}
      viewportPinned={cookieStore.get(VIEWPORT_PINNED_COOKIE)?.value === "1"}
      preferences={getUserPreferences(deps.userPreferencesRepo, currentUser.id)}
      // Plain data across the boundary — the view is a client island and can't
      // be handed the module records themselves.
      modules={accessibleModules.map((appModule) => ({
        slug: appModule.slug,
        name: appModule.longName,
        hasImage: appModule.hasCarouselImage,
        imageVersion: appModule.updatedAt,
      }))}
    />
  );
}
