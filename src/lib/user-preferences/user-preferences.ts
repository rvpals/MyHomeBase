import { FLOATING_STATE_KEYS, floatingStateToValue, puckCornerKey } from "@/lib/floating";
import type { UserPreferencesRepository } from "./ports";
import {
  USER_PREFERENCE_KEYS,
  userPreferencesToEntries,
  resolveUserPreferences,
} from "./preferences";
import {
  calculatorStateUpdateSchema,
  floatingCornerUpdateSchema,
  floatingStateUpdateSchema,
  userPreferencesUpdateSchema,
  type CalculatorStateUpdate,
  type FloatingCornerUpdate,
  type FloatingStateUpdate,
  type UserPreferencesUpdate,
} from "./schema";
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

  // `null` (an explicit "clear my location") and `undefined` (the field absent from
  // an older client's payload) both mean "store nothing" here, and the serializer
  // writes "" for either. They are only distinct on the wire, so they are collapsed
  // at this boundary rather than pushed further in.
  userPreferencesToEntries({
    ...validated,
    weatherLocation: validated.weatherLocation ?? undefined,
  }).forEach((entry) => {
    repo.setValue(userId, entry.key, entry.value);
  });

  return getUserPreferences(repo, userId);
}

/**
 * Records the shape one floating component is in for one reader.
 *
 * A single-key write, not a whole-preferences save: this fires every time a reader
 * minimizes or closes a window, and resending the rest of their preferences on each
 * of those would let a stale client clobber a favorite they changed in another tab.
 * The repository's `setValue` is per-key for exactly this reason.
 *
 * Returns the stored state rather than void so the caller can confirm the write took
 * without a second read.
 */
export function saveFloatingState(
  repo: UserPreferencesRepository,
  userId: number,
  input: FloatingStateUpdate,
): FloatingStateUpdate {
  const validated = floatingStateUpdateSchema.parse(input);
  repo.setValue(
    userId,
    FLOATING_STATE_KEYS[validated.id],
    floatingStateToValue(validated.state),
  );
  return validated;
}

/**
 * Records which corner one floating component's puck docks in.
 *
 * A single-key write, like `saveFloatingState` — and deliberately a different key, so
 * choosing a corner cannot disturb whether the window is open.
 */
export function saveFloatingCorner(
  repo: UserPreferencesRepository,
  userId: number,
  input: FloatingCornerUpdate,
): FloatingCornerUpdate {
  const validated = floatingCornerUpdateSchema.parse(input);
  repo.setValue(userId, puckCornerKey(validated.id), validated.corner);
  return validated;
}

/**
 * Records the calculator's angle mode, its last result, or both.
 *
 * Single-key writes, like `saveFloatingState` above and for the same reason: this fires
 * on every completed calculation, and resending the whole preference set each time
 * would let a stale client clobber a favorite changed in another tab. Each field is
 * optional, so flipping the angle mode cannot blank the last result.
 */
export function saveCalculatorState(
  repo: UserPreferencesRepository,
  userId: number,
  input: CalculatorStateUpdate,
): void {
  const validated = calculatorStateUpdateSchema.parse(input);
  if (validated.angleMode !== undefined) {
    repo.setValue(userId, USER_PREFERENCE_KEYS.calculatorAngleMode, validated.angleMode);
  }
  if (validated.lastResult !== undefined) {
    repo.setValue(userId, USER_PREFERENCE_KEYS.calculatorLastResult, validated.lastResult);
  }
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
