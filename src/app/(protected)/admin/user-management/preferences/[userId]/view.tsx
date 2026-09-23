"use client";

import { useMemo, type ReactNode } from "react";
import type { FloatingId } from "@/lib/floating";
import type { User } from "@/lib/user";
import type {
  FloatingCornerUpdate,
  FloatingStateUpdate,
  UserPreferences,
  UserPreferencesUpdate,
} from "@/lib/user-preferences";
import {
  AccountView,
  type AccountModuleOption,
  type AccountViewActions,
} from "../../../../account/view";
import {
  adminChangePasswordAction,
  adminRemoveAvatarAction,
  adminSaveFloatingCornerAction,
  adminSaveFloatingStateAction,
  adminSavePreferencesAction,
  adminUploadAvatarAction,
} from "./preferences-actions";

/**
 * Binds this admin screen's target user to the Account screen's action bundle.
 *
 * A client component purely because that binding has to happen on the client: the
 * page is a server component, and a closure it built would have to be serialised
 * across the boundary, which server-action references inside an object literal
 * cannot be. Here each action is imported directly — the `"use server"` module is
 * importable from a client component, which is exactly how the rest of the app calls
 * actions — and wrapped in an arrow that supplies `userId`.
 *
 * **The id supplied here is a convenience, not a permission.** Every action re-checks
 * `requireAdmin()` and re-resolves the id server-side, so editing this value in a
 * browser buys nothing an admin could not already do from the user list. The screen
 * would be exactly as safe if this component passed the wrong id — it would simply
 * edit the wrong account, which is why the page renders the target's name in the
 * heading and the intro.
 *
 * `useMemo` so the bundle is not a fresh object on every render; `AccountView` passes
 * it down to four sections, and a new identity each time would defeat any
 * memoisation added there later.
 */
export function AdminUserPreferencesView({
  target,
  preferences,
  modules,
  enabledFloating,
  banner,
  intro,
}: {
  target: User;
  preferences: UserPreferences;
  modules: AccountModuleOption[];
  enabledFloating: readonly FloatingId[];
  banner: ReactNode;
  intro: ReactNode;
}) {
  const actions = useMemo<AccountViewActions>(
    () => ({
      uploadAvatar: (formData: FormData) => {
        // The action reads the id from the body, matching the user-list uploader —
        // so it is set here rather than passed alongside. `set` not `append`: the
        // form itself has no `userId` field, but overwriting is the safe shape if
        // one is ever added.
        formData.set("userId", String(target.id));
        return adminUploadAvatarAction(formData);
      },
      removeAvatar: () => adminRemoveAvatarAction(target.id),
      changePassword: (password: string) => adminChangePasswordAction(target.id, password),
      savePreferences: (input: UserPreferencesUpdate) =>
        adminSavePreferencesAction(target.id, input),
      saveFloatingState: (input: FloatingStateUpdate) =>
        adminSaveFloatingStateAction(target.id, input),
      saveFloatingCorner: (input: FloatingCornerUpdate) =>
        adminSaveFloatingCornerAction(target.id, input),
    }),
    [target.id],
  );

  return (
    <AccountView
      user={target}
      heading={`Preferences — ${target.fullName}`}
      actions={actions}
      banner={banner}
      intro={intro}
      preferences={preferences}
      modules={modules}
      enabledFloating={enabledFloating}
      // No `viewport`: it is a cookie on this browser, so it would describe the
      // admin's own layout under the target's name. `AccountView` drops the whole
      // Layout note when it is absent.
    />
  );
}
