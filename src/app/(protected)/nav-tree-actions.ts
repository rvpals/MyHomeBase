"use server";

import { getUserPreferences, saveUserPreferences } from "@/lib/user-preferences";
import { getAccessibleModules } from "@/lib/user";
import { listModules } from "@/lib/modules";
import { deps } from "@/lib/wiring";
import { requireUser } from "./require-access";

/**
 * Records which modules the reader has expanded in the navigation tree.
 *
 * `requireUser()` on the first line. The tree is whole-app chrome that no module
 * owns — the same category the floating-layer and weather actions fall in — so a
 * session is the whole rule. An action is its own POST endpoint, so neither the
 * `(protected)` layout nor the fact that the only caller is a chevron in the tree
 * guards it.
 *
 * The session decides *whose* preference this is; the client never supplies a user
 * id, so this cannot be used to rearrange someone else's navigation.
 *
 * **Read-modify-write, not a blind save.** `saveUserPreferences` writes every key on
 * every call, so passing only the expanded set would blank this reader's weather
 * location, clock and nav style — the trap `src/cli/user-preferences.ts` already
 * documents. The current preferences are read and spread first.
 *
 * Returns nothing and throws nothing the caller acts on: the tree has already moved
 * by the time this fires, and a failed write costs a remembered chevron, not a
 * navigation. Deliberately not `revalidatePath` — this preference only affects the
 * tree's *initial* expanded set, and revalidating would re-render every route in the
 * layout to change nothing the reader can see.
 */
export async function setExpandedModulesAction(slugs: string[]): Promise<void> {
  const currentUser = await requireUser();

  // Validated in `userPreferencesUpdateSchema` (an array of non-empty strings,
  // capped), so a hand-rolled payload can't write an unbounded blob. Not checked
  // against the module list on purpose: an unknown slug is inert, and dropping it
  // would forget a reader's choice whenever an admin toggled a module off.
  const current = getUserPreferences(deps.userPreferencesRepo, currentUser.id);
  const accessibleModules = getAccessibleModules(
    currentUser,
    listModules(deps.moduleRepo),
    deps.userRepo,
  );

  saveUserPreferences(
    deps.userPreferencesRepo,
    currentUser.id,
    {
      favoriteModuleSlug: current.favoriteModuleSlug ?? "",
      openFavoriteModuleOnStartup: current.openFavoriteModuleOnStartup,
      compactNavStyle: current.compactNavStyle,
      expandedModules: slugs,
      weatherLocation: current.weatherLocation ?? null,
      weatherUnit: current.weatherUnit,
      clock: current.clock,
    },
    accessibleModules.map((appModule) => appModule.slug),
  );
}
