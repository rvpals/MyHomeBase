import {
  FLOATING_POSITIONS_PREFERENCE_KEY,
  FLOATING_STATE_KEYS,
  clearPuckPosition,
  floatingPositionResetSchema,
  floatingPositionSchema,
  floatingStateToValue,
  parsePuckPositions,
  puckCornerKey,
  serializePuckPositions,
  setPuckPosition,
  type FloatingPositionInput,
  type FloatingPositionResetInput,
} from "@/lib/floating";
import {
  homeLayoutPartialUpdateSchema,
  homeWidgetOrderToValue,
  hiddenHomeWidgetsToValue,
  type HomeLayoutPartialUpdate,
} from "@/lib/home-layout";
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
 * Records this reader's home screen arrangement — the column count, the card order,
 * the cards they have closed, or any combination.
 *
 * Single-key writes, like `saveFloatingState` above and for the same reason: this
 * fires on every drop, every flip of the column switch and every card closed, and
 * resending the whole preference set each time would let a stale home screen clobber a
 * favorite the reader changed in another tab. Each field is optional, so flipping to
 * one column cannot blank an order the reader spent time arranging, and closing a card
 * cannot rewrite either.
 *
 * Writes only — it does not read the household `home_widgets` setting and cannot make
 * a card an admin hid appear. `hidden` subtracts from what that setting allows; it
 * never adds, and `applyHiddenWidgets` is where that is enforced on the way out.
 */
export function saveHomeLayout(
  repo: UserPreferencesRepository,
  userId: number,
  input: HomeLayoutPartialUpdate,
): void {
  const validated = homeLayoutPartialUpdateSchema.parse(input);
  if (validated.columns !== undefined) {
    repo.setValue(userId, USER_PREFERENCE_KEYS.homeColumns, String(validated.columns));
  }
  if (validated.order !== undefined) {
    repo.setValue(
      userId,
      USER_PREFERENCE_KEYS.homeWidgetOrder,
      homeWidgetOrderToValue(validated.order),
    );
  }
  if (validated.hidden !== undefined) {
    repo.setValue(
      userId,
      USER_PREFERENCE_KEYS.homeHiddenWidgets,
      hiddenHomeWidgetsToValue(validated.hidden),
    );
  }
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

/**
 * Records where one reader has dragged one puck.
 *
 * **Read-modify-write, unlike every other save in this file.** The others own a key
 * each, so they can set it blind. Every puck's position shares the single
 * `floating_positions` row (see `src/lib/floating/position.ts` for why the storage is
 * one key), so writing one without first reading the rest would drop the others.
 *
 * The read is of this reader's own rows, which the caller has usually just loaded
 * anyway — but it is done here rather than taken as a parameter so a caller cannot
 * pass a stale map and silently erase a puck they were not touching.
 *
 * Still a single-key `setValue`, never `userPreferencesToEntries`: that writes every
 * key it carries, which would let a drag clobber a favorite the reader changed in
 * another tab. Same rule `saveFloatingState` and `setToolbarPosition` both follow.
 */
export function saveFloatingPosition(
  repo: UserPreferencesRepository,
  userId: number,
  input: FloatingPositionInput,
): FloatingPositionInput {
  const validated = floatingPositionSchema.parse(input);
  const current = parsePuckPositions(
    repo
      .listByUserId(userId)
      .find((row) => row.key === FLOATING_POSITIONS_PREFERENCE_KEY)?.value,
  );
  const next = setPuckPosition(current, validated.id, {
    x: validated.x,
    y: validated.y,
  });
  repo.setValue(userId, FLOATING_POSITIONS_PREFERENCE_KEY, serializePuckPositions(next));
  return validated;
}

/**
 * Forgets where one puck was dragged, so it docks in its corner again.
 *
 * The recovery route, and the reason it exists: a puck dropped somewhere awkward on a
 * screen the reader no longer has — a second monitor, a window since resized — is
 * otherwise only reachable by dragging it back on that same screen. `clampPuckPosition`
 * keeps a grabbable strip on screen so this is belt-and-braces rather than the only way
 * out, but "put it back" should not require a gesture.
 *
 * Removing the entry rather than storing a default is deliberate — see
 * `clearPuckPosition`. It is also what returns the puck to the corner queue, so it
 * starts clearing the music bar and the section panel again.
 */
export function resetFloatingPosition(
  repo: UserPreferencesRepository,
  userId: number,
  input: FloatingPositionResetInput,
): FloatingPositionResetInput {
  const validated = floatingPositionResetSchema.parse(input);
  const current = parsePuckPositions(
    repo
      .listByUserId(userId)
      .find((row) => row.key === FLOATING_POSITIONS_PREFERENCE_KEY)?.value,
  );
  const next = clearPuckPosition(current, validated.id);
  repo.setValue(userId, FLOATING_POSITIONS_PREFERENCE_KEY, serializePuckPositions(next));
  return validated;
}
