"use client";

// `localStorage` as a React external store.
//
// ## The problem this replaces
//
// Half a dozen components here reach for the same shape: `useState(default)`,
// then an effect that reads `localStorage` on mount and calls `setState`. It
// works, and `react-hooks/set-state-in-effect` is right to flag it — the
// component renders once with the default and again with the stored value,
// which is a cascading render and, on a collapsible card, a visible flash.
//
// Reading storage in the `useState` initializer instead is worse: it does not
// exist during SSR, so the server and the first client render disagree and
// hydration blows up. That is why those effects were written the way they were.
//
// `useSyncExternalStore` is the API for exactly this. `getServerSnapshot` keeps
// the server render honest, and React handles the handoff.
//
// ## Why the listener set
//
// The `storage` event fires only in *other* tabs — a write in this tab notifies
// nobody. So writes go through `writeStoredValue`, which tells this tab's
// subscribers directly. Both paths together mean a preference set in one window
// follows along in another, which the effect version never managed.

import { useCallback, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * The raw string at `key`, or `null`.
 *
 * `null` during SSR and on the first client render, which is what makes the
 * hydration safe — a caller must have a sensible answer for "not known yet",
 * and that answer is usually its default.
 *
 * Returns the raw string rather than parsed anything: `useSyncExternalStore`
 * compares snapshots by identity, and a fresh object per call would loop
 * forever. Parse it in a `useMemo` in the caller.
 */
export function useStoredValue(key: string): string | null {
  const getSnapshot = useCallback(() => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      // Private mode, blocked site data, a browser that throws on access.
      // Never a reason to fail to draw the screen.
      return null;
    }
  }, [key]);

  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

/**
 * Writes `key` and tells this tab's subscribers.
 *
 * Swallows a storage failure on purpose — a full or blocked store means the
 * preference is not remembered, which is not worth breaking a click over.
 */
export function writeStoredValue(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // As above.
  }
  // `storage` does not fire in the tab that wrote, so this is the only thing
  // that updates the component that just called it.
  for (const listener of listeners) listener();
}
