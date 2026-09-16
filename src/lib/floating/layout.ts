import { DEFAULT_PUCK_CORNER } from "./corners";
import { FLOATING_COMPONENTS } from "./registry";
import type { FloatingId, FloatingState, PuckCorner, PuckSlot } from "./types";

/**
 * Which minimized pucks park where, and in what order.
 *
 * The bottom-right corner is **already occupied**: `MusicPlayerBar` minimizes to a 56px
 * puck there (`.music-player-puck`, z-30), and the compact section trigger and the music
 * bar both claim height on that edge. So a floating puck cannot simply take the corner —
 * it has to queue behind whatever is already in it.
 *
 * This function owns only the *order*. It deliberately returns an index, not a pixel
 * offset, because `lib` must not know a puck's height or what `env(safe-area-inset-bottom)`
 * resolves to — the CSS owns that arithmetic (`--floating-puck-size`). Keeping the
 * ordering here is what makes the stacking testable with no browser, which is the only
 * way this particular bug class gets caught: two pucks overlapping is invisible to
 * `/verify` (Playwright's WebKit doesn't emulate insets, per design.md).
 *
 * **Stacking is per corner.** Each corner queues independently, so two pucks the reader
 * has docked in different corners both sit at index 0 — and only the corner the music
 * puck occupies has to make room for it. That is the whole reason this takes the corner
 * map rather than assuming one corner.
 *
 * @param states       each component's current state, by id
 * @param corners      each component's docked corner, by id
 * @param musicPuckUp  whether the music player is *itself* minimized to its puck
 */
export function resolvePuckSlots(
  states: Readonly<Partial<Record<FloatingId, FloatingState>>>,
  corners: Readonly<Partial<Record<FloatingId, PuckCorner>>>,
  musicPuckUp: boolean,
): PuckSlot[] {
  // Registry order, so two pucks sharing a corner never swap places just because the
  // reader happened to minimize them in the other order. A puck that moves on its own
  // is harder to hit than one that is simply further from the corner.
  const minimized = FLOATING_COMPONENTS.filter(
    (component) => states[component.id] === "minimized",
  );

  // How many pucks are already parked in each corner. The music puck holds index 0 of
  // **bottom-right only** when it is up, so a puck docked there starts at 1 while one
  // in any other corner still starts at 0.
  //
  // When music is playing but *not* minimized, its bar is pinned across the bottom edge
  // instead — that height is already published as `--music-player-height` and the CSS
  // reads it, so it costs no slot here.
  const nextIndex = new Map<PuckCorner, number>();
  if (musicPuckUp) nextIndex.set("bottom-right", 1);

  return minimized.map((component) => {
    const corner = corners[component.id] ?? DEFAULT_PUCK_CORNER;
    const index = nextIndex.get(corner) ?? 0;
    nextIndex.set(corner, index + 1);
    return { id: component.id, index, corner };
  });
}

/**
 * What `_` does: `open` -> `minimized`. Any other state is returned unchanged.
 *
 * These three transitions are functions rather than inline `setState` calls in the
 * provider because they are the actual rules of the layer, and a rule that lives in a
 * component can't be tested without rendering one. They also make the illegal moves
 * explicit — minimizing a closed component is a no-op, not an error, since a stale
 * click on a puck that just closed shouldn't resurrect it.
 */
export function minimizeState(state: FloatingState): FloatingState {
  return state === "open" ? "minimized" : state;
}

/** What tapping a puck does: `minimized` -> `open`. A closed component stays closed. */
export function restoreState(state: FloatingState): FloatingState {
  return state === "minimized" ? "open" : state;
}

/**
 * What `X` does: gone, from wherever it was.
 *
 * Unconditional, unlike the other two. `X` on the window and `X` on a puck mean the
 * same thing, and a component can only be closed from a state where it is visible.
 */
export function closeState(): FloatingState {
  return "closed";
}

/**
 * The state a component should be in, given what the reader stored and whether an admin
 * still has it enabled.
 *
 * **Disabled wins.** An admin turning a component off takes it off every reader's screen
 * immediately, whatever they had stored — otherwise "disabled" would mean "disabled for
 * people who haven't used it", which is not what the switch says. The reader's own row
 * is left alone rather than rewritten, so re-enabling restores what they had instead of
 * resetting everyone to closed.
 */
export function effectiveState(
  stored: FloatingState,
  isEnabled: boolean,
): FloatingState {
  return isEnabled ? stored : "closed";
}
