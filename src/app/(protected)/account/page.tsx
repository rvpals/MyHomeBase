import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { listModules } from "@/lib/modules";
import { getAccessibleModules } from "@/lib/user";
import { getEnabledFloating } from "@/lib/floating";
import { getUserPreferences } from "@/lib/user-preferences";
import {
  VIEWPORT_COOKIE,
  VIEWPORT_PINNED_COOKIE,
  resolveViewport,
} from "@/lib/viewport";
import { deps } from "@/lib/wiring";
import { HomeShell } from "../home-shell";
import { AccountView } from "./view";
import {
  changeOwnPasswordAction,
  removeOwnAvatarAction,
  saveFloatingCornerAction,
  saveFloatingStateAction,
  saveOwnPreferencesAction,
  uploadOwnAvatarAction,
} from "./actions";

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
    // Belongs to no module, so the shell gives it the rail and the header but
    // no section panel — see `home-shell.tsx`.
    <HomeShell label="My account" icon="home" href="/account">
      <AccountView
        user={currentUser}
        // The session-scoped set: every one of these reads the subject from the
        // cookie and takes no user id, so this screen can only ever edit the reader
        // looking at it. Administration passes admin-guarded twins instead.
        actions={{
          uploadAvatar: uploadOwnAvatarAction,
          removeAvatar: removeOwnAvatarAction,
          changePassword: changeOwnPasswordAction,
          savePreferences: saveOwnPreferencesAction,
          saveFloatingState: saveFloatingStateAction,
          saveFloatingCorner: saveFloatingCornerAction,
        }}
        viewport={resolveViewport({ cookieValue: cookieStore.get(VIEWPORT_COOKIE)?.value })}
        viewportPinned={cookieStore.get(VIEWPORT_PINNED_COOKIE)?.value === "1"}
        preferences={getUserPreferences(deps.userPreferencesRepo, currentUser.id)}
        // Read here rather than in the view: which components are available is an
        // app-wide setting, and the view is a client island.
        enabledFloating={getEnabledFloating(deps.settingsRepo)}
        // Plain data across the boundary — the view is a client island and can't
        // be handed the module records themselves.
        modules={accessibleModules.map((appModule) => ({
          slug: appModule.slug,
          name: appModule.longName,
          hasImage: appModule.hasCarouselImage,
          imageVersion: appModule.updatedAt,
        }))}
      />
    </HomeShell>
  );
}
