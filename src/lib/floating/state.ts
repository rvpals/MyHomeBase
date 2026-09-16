import { FLOATING_COMPONENTS, isFloatingId } from "./registry";
import type { FloatingId, FloatingState } from "./types";

/**
 * Each component's own user-preference key.
 *
 * Derived from the registry rather than written out, so a new floating component can't
 * ship with a missing key. The prefix keeps them grouped in `usr_preferences`, where
 * they sit alongside `weather_unit` and friends — key/value rows, so **no migration**
 * (see migrations/0044).
 */
export const FLOATING_STATE_KEYS: Readonly<Record<FloatingId, string>> = Object.freeze(
  Object.fromEntries(
    FLOATING_COMPONENTS.map((component) => [component.id, `floating_state_${component.id}`]),
  ) as Record<FloatingId, string>,
);

/** Whether `value` names a state — the guard for a stored row. */
export function isFloatingState(value: string): value is FloatingState {
  return value === "closed" || value === "minimized" || value === "open";
}

/**
 * The stored state, or the default for a reader who has never touched this component.
 *
 * Defaults to `closed`, which is the same conservative direction `enabledByDefault`
 * takes: a window that appears over every page unbidden after an upgrade is worse than
 * one the reader opens deliberately. The Account screen is where they turn it on, and
 * the state persists from there — per the decision that a reload shouldn't lose it.
 */
function resolveOne(value: string | undefined): FloatingState {
  const trimmed = value?.trim();
  return trimmed !== undefined && isFloatingState(trimmed) ? trimmed : "closed";
}

/**
 * Every registered component's state for one reader, from their raw preference rows.
 *
 * Returns a full record — a component with no row lands `closed` rather than absent — so
 * the provider and the Account screen never branch on whether a row existed. Same
 * contract `resolveUserPreferences` holds for the rest of the preferences.
 */
export function resolveFloatingStates(
  byKey: ReadonlyMap<string, string>,
): Record<FloatingId, FloatingState> {
  return Object.fromEntries(
    FLOATING_COMPONENTS.map((component) => [
      component.id,
      resolveOne(byKey.get(FLOATING_STATE_KEYS[component.id])),
    ]),
  ) as Record<FloatingId, FloatingState>;
}

/**
 * A state as stored.
 *
 * Trivial today — the union's members are already the stored form — but it exists so the
 * write path names a function rather than passing a raw string, which is what keeps a
 * future rename (or a compacted encoding) from having to hunt down call sites.
 */
export function floatingStateToValue(state: FloatingState): string {
  return state;
}

/** The preference key for one component, or `undefined` for an unknown id. */
export function floatingStateKey(id: string): string | undefined {
  return isFloatingId(id) ? FLOATING_STATE_KEYS[id] : undefined;
}
