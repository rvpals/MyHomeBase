"use client";

// The floating layer's state: which floating components are open, minimized or closed.
// Mount once, in the protected layout — not inside a page, or a floating window would
// vanish the moment you navigated (the same reason `MusicPlayerProvider` lives there).
//
// The state *rules* are not here. `minimizeState`, `restoreState`, `closeState` and
// `effectiveState` live in `src/lib/floating`, where they're unit-tested without a
// browser; this component is the adapter that holds the current value, mirrors it onto
// `<html>` for the CSS, and persists it.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  closeState,
  effectiveState,
  minimizeState,
  resolvePuckSlots,
  restoreState,
  type FloatingId,
  type FloatingState,
  type PuckCorner,
} from "@/lib/floating";

/**
 * Persists one component's state for the signed-in reader.
 *
 * **Injected, not imported** — a component under `src/components/` importing from
 * `src/app/` would invert the dependency the layering rests on. Exactly the seam
 * `MusicPlayerProvider` uses for its queue actions and `NavMenus` for `logoutAction`.
 * It also means the provider renders in a test with a fake and no database.
 */
export interface FloatingActions {
  /**
   * Signature matches the server action **exactly**, so the mount site can assign the
   * action itself rather than wrapping it.
   *
   * That is not a style preference. A `"use server"` function is passable to a client
   * component because React recognises *that* function; wrapping it in an arrow
   * (`(id, state) => action({ id, state })`) produces an ordinary closure, and
   * serializing it fails at runtime with "Functions cannot be passed directly to Client
   * Components". So a port here takes one object, as the action does — the same rule
   * every method on `MusicQueueActions` follows.
   */
  saveState: (input: {
    id: FloatingId;
    state: FloatingState;
  }) => Promise<{ ok: boolean; error?: string }>;
  /**
   * Persists one component's docked corner. Same exact-signature rule as `saveState`.
   *
   * Separate from `saveState` because they change for different reasons: a corner is a
   * standing preference set once on the Account screen, while a state changes every
   * time a window is minimized. One combined write would mean either could clobber
   * the other's field.
   */
  saveCorner: (input: {
    id: FloatingId;
    corner: PuckCorner;
  }) => Promise<{ ok: boolean; error?: string }>;
}

export interface FloatingLayerValue {
  /** Every enabled component's current state. A disabled one is absent entirely. */
  states: Partial<Record<FloatingId, FloatingState>>;
  /** Whether an admin has this component enabled for the household. */
  isEnabled: (id: FloatingId) => boolean;
  /** Where each minimized puck parks — index 0 is nearest its corner. */
  puckSlots: ReturnType<typeof resolvePuckSlots>;
  /** Each component's docked corner. */
  corners: Partial<Record<FloatingId, PuckCorner>>;
  /** Moves a component's puck to another corner, and remembers it. */
  setCorner: (id: FloatingId, corner: PuckCorner) => void;
  open: (id: FloatingId) => void;
  minimize: (id: FloatingId) => void;
  close: (id: FloatingId) => void;
  /**
   * What tapping a puck does. Distinct from `open` so a stale tap on a component that
   * has just been closed is a no-op rather than resurrecting it — `restoreState` only
   * moves `minimized`.
   */
  restore: (id: FloatingId) => void;
}

const FloatingLayerContext = createContext<FloatingLayerValue | undefined>(undefined);

/**
 * The layer's state, or `undefined` outside the provider.
 *
 * `undefined` rather than throwing, matching `useMusicPlayer()`: it lets a component
 * render in isolation (a test, a Storybook-style page) without a provider around it.
 */
export function useFloatingLayer(): FloatingLayerValue | undefined {
  return useContext(FloatingLayerContext);
}

export function FloatingLayerProvider({
  children,
  enabled,
  initialStates,
  initialCorners,
  actions,
  musicPuckUp = false,
}: {
  children: ReactNode;
  /** The ids an admin has enabled, resolved on the server. */
  enabled: readonly FloatingId[];
  /** Each component's stored state for this reader, resolved on the server. */
  initialStates: Partial<Record<FloatingId, FloatingState>>;
  /** Each component's stored corner, resolved on the server. */
  initialCorners: Partial<Record<FloatingId, PuckCorner>>;
  actions: FloatingActions;
  /**
   * Whether the music player is itself minimized to its puck, so a floating puck
   * queues behind it instead of landing on top. Read from `useMusicPlayer()` by the
   * mount site rather than here — this provider has no business depending on the
   * player, and passing the boolean keeps the two independent.
   */
  musicPuckUp?: boolean;
}) {
  const enabledSet = useMemo(() => new Set(enabled), [enabled]);

  // Seeded from the server-resolved states, with `effectiveState` applied so a component
  // an admin disabled is closed from the first paint rather than flashing open.
  const [states, setStates] = useState<Partial<Record<FloatingId, FloatingState>>>(() => {
    const seeded: Partial<Record<FloatingId, FloatingState>> = {};
    for (const [id, state] of Object.entries(initialStates) as [FloatingId, FloatingState][]) {
      if (enabledSet.has(id)) seeded[id] = effectiveState(state, true);
    }
    return seeded;
  });

  /**
   * Applies a transition and persists the result.
   *
   * Optimistic: the state moves immediately and the write follows. A floating window
   * that waited for a round-trip before minimizing would feel broken on a NAS over
   * wifi, and the stakes are a window position — if the write fails the reader sees
   * the shape they asked for and the next reload shows the stored one.
   */
  const applyTransition = useCallback(
    (id: FloatingId, transition: (state: FloatingState) => FloatingState) => {
      if (!enabledSet.has(id)) return;
      setStates((current) => {
        const next = transition(current[id] ?? "closed");
        if (next === current[id]) return current;
        void actions.saveState({ id, state: next });
        return { ...current, [id]: next };
      });
    },
    [actions, enabledSet],
  );

  // `open` is not a transition of the other three: it is reached from `closed` (the
  // Account screen turning it on) and from `minimized` (tapping the puck), so it sets
  // rather than maps. `restoreState` still guards the puck path.
  const open = useCallback(
    (id: FloatingId) => {
      if (!enabledSet.has(id)) return;
      setStates((current) => {
        if (current[id] === "open") return current;
        void actions.saveState({ id, state: "open" });
        return { ...current, [id]: "open" };
      });
    },
    [actions, enabledSet],
  );

  const minimize = useCallback(
    (id: FloatingId) => applyTransition(id, minimizeState),
    [applyTransition],
  );
  const close = useCallback((id: FloatingId) => applyTransition(id, closeState), [applyTransition]);
  const restore = useCallback(
    (id: FloatingId) => applyTransition(id, restoreState),
    [applyTransition],
  );

  // The corners the reader has chosen. Local so a change is reflected at once, seeded
  // from the server-resolved values.
  const [corners, setCorners] = useState<Partial<Record<FloatingId, PuckCorner>>>(
    () => ({ ...initialCorners }),
  );

  const setCorner = useCallback(
    (id: FloatingId, corner: PuckCorner) => {
      setCorners((current) => {
        if (current[id] === corner) return current;
        void actions.saveCorner({ id, corner });
        return { ...current, [id]: corner };
      });
    },
    [actions],
  );

  const puckSlots = useMemo(
    () => resolvePuckSlots(states, corners, musicPuckUp),
    [states, corners, musicPuckUp],
  );

  // Mirror the layer's presence onto `<html>`, the same seam `SectionPanel` and the
  // music player use. `.app-main` belongs to a *server* layout that cannot see this
  // client state, so anything the page must react to travels as an attribute.
  //
  // Deliberately **no published height**: a puck floats over content rather than
  // pushing it up, exactly as `html[data-music-player="minimized"]` publishes `0px`.
  // The attribute is here so a future rule can target the layer without this file
  // having to grow one.
  useEffect(() => {
    const active = Object.values(states).some((state) => state !== "closed");
    if (active) {
      document.documentElement.setAttribute("data-floating", "active");
    } else {
      document.documentElement.removeAttribute("data-floating");
    }
    return () => document.documentElement.removeAttribute("data-floating");
  }, [states]);

  const value = useMemo<FloatingLayerValue>(
    () => ({
      states,
      isEnabled: (id: FloatingId) => enabledSet.has(id),
      puckSlots,
      corners,
      setCorner,
      open,
      minimize,
      close,
      restore,
    }),
    [states, enabledSet, puckSlots, corners, setCorner, open, minimize, close, restore],
  );

  return <FloatingLayerContext.Provider value={value}>{children}</FloatingLayerContext.Provider>;
}
