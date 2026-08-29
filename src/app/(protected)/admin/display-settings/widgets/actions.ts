"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import {
  HOME_WIDGETS_SETTING_KEY,
  homeWidgetsToValue,
  type HomeWidgetsInput,
} from "@/lib/home-dashboard";
import { updateSettings } from "@/lib/settings";
import { isAdmin } from "@/lib/user";
import { deps } from "@/lib/wiring";

/**
 * Rejects a caller who isn't an admin.
 *
 * The `/admin` layout already redirects a non-admin, which covers the screen but not
 * this endpoint: a server action is reachable by anyone who can post to it, layout or
 * no layout. Same check, and same reasoning, as the texture actions.
 */
async function requireAdmin(): Promise<void> {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser || !isAdmin(currentUser)) throw new Error("Administrators only.");
}

export interface SaveHomeWidgetsResult {
  ok: boolean;
  error?: string;
}

/**
 * Persists the home screen layout as the `home_widgets` app setting.
 *
 * Validation — every card exactly once, no duplicates, no unknown ids — belongs to the
 * lib's `homeWidgetsToValue`, not to this adapter. It throws on a bad payload and the
 * catch turns that into a message the form can show.
 *
 * The setting row is seeded by migrations/0067 and must exist: `updateSettings` goes
 * through a plain `UPDATE ... WHERE key = ?`, so against a database missing the row this
 * would report success and write nothing.
 */
export async function saveHomeWidgetsAction(
  widgets: HomeWidgetsInput,
): Promise<SaveHomeWidgetsResult> {
  try {
    await requireAdmin();
    updateSettings(deps.settingsRepo, [
      { key: HOME_WIDGETS_SETTING_KEY, value: homeWidgetsToValue(widgets) },
    ]);
    // "layout" because the home screen this changes is a different route from this form.
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to save the widget layout.",
    };
  }
}
