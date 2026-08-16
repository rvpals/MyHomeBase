import type { UserPreferencesRepository } from "./ports";
import { userPreferencesToEntries, resolveUserPreferences } from "./preferences";
import { userPreferencesUpdateSchema, type UserPreferencesUpdate } from "./schema";
import type { UserPreferences } from "./types";

/** Thrown when a save names a module the user can't reach (hidden, or not granted). */
export class UnknownFavoriteModuleError extends Error {
  constructor(slug: string) {
    super(`No accessible module with the slug "${slug}".`);
    this.name = "UnknownFavoriteModuleError";
  }
}

/**
 * One user's preferences, typed. A user with no stored rows gets the defaults —
 * no favorite, no startup redirect — which is what every existing account has.
 */
export function getUserPreferences(
  repo: UserPreferencesRepository,
  userId: number,
): UserPreferences {
  return resolveUserPreferences(repo.listByUserId(userId));
}

/**
 * Validates and stores a user's preferences, returning what is now stored.
 *
 * `allowedModuleSlugs` is the set this user may favorite — the caller passes the
 * modules it already fetched for the picker. Validating here rather than in the
 * schema is deliberate: a zod schema can't know which modules exist, and it
 * certainly can't know which *this* user has been granted. Without the check, a
 * hand-rolled request could set a favorite pointing at a module the user can't
 * open, and the startup redirect would then be a dead end for them.
 */
export function saveUserPreferences(
  repo: UserPreferencesRepository,
  userId: number,
  input: UserPreferencesUpdate,
  allowedModuleSlugs: string[],
): UserPreferences {
  const validated = userPreferencesUpdateSchema.parse(input);

  if (validated.favoriteModuleSlug && !allowedModuleSlugs.includes(validated.favoriteModuleSlug)) {
    throw new UnknownFavoriteModuleError(validated.favoriteModuleSlug);
  }

  userPreferencesToEntries(validated).forEach((entry) => {
    repo.setValue(userId, entry.key, entry.value);
  });

  return getUserPreferences(repo, userId);
}

/**
 * Where this user should land on reaching the home screen: a module slug, or
 * `undefined` for the home screen itself.
 *
 * Pure — it takes the already-resolved preferences and the modules the user can
 * currently reach, so the redirect decision is testable without a database or a
 * request. Returns `undefined` in three cases, all of which have to degrade to
 * the home screen rather than to an error:
 *
 * - the startup flag is off (the ordinary case);
 * - no favorite is set;
 * - the favorite is no longer among the user's accessible modules — it was
 *   hidden by an admin, removed, or their access was revoked after they chose
 *   it. Redirecting anyway would strand them somewhere they can't open, with no
 *   way back to the screen holding the control that would fix it.
 */
export function resolveStartupDestination(
  preferences: UserPreferences,
  accessibleModuleSlugs: string[],
): string | undefined {
  if (!preferences.openFavoriteModuleOnStartup) return undefined;
  const slug = preferences.favoriteModuleSlug;
  if (!slug) return undefined;
  return accessibleModuleSlugs.includes(slug) ? slug : undefined;
}
