"use client";

// A black, chromeless container that fills the physical screen.
//
// Presentation only: it owns the Fullscreen API handshake and nothing else. What goes
// on the stage is the caller's business, and the caller is told when the viewer leaves
// so it can drop the element from the tree.
//
// Why the real Fullscreen API and not a `fixed inset-0` overlay: an overlay still sits
// inside the browser window, so the tab strip, the URL bar and the OS taskbar stay
// visible. For something whose entire purpose is to be looked at, that chrome is the
// thing you are trying to get rid of. `Modal size="full"` is the right answer for a
// dialog that wants the whole viewport; this is the right answer for a display.
//
// Exit is deliberately not a button of our own. Escape already exits fullscreen at the
// browser level and cannot be intercepted, so a custom handler would either duplicate
// it or fight it -- instead we listen for the exit and report it upward.

import { useCallback, useEffect, useRef, type ReactNode } from "react";

export interface FullscreenStageProps {
  /** What to show on the stage. Rendered inside the fullscreened element. */
  children: ReactNode;
  /**
   * Fired when the viewer has left fullscreen -- Escape, the browser's own control, or
   * a failed request. The caller should stop rendering the stage in response; leaving
   * it mounted would show a black box in the middle of the page.
   */
  onExit: () => void;
  /**
   * Accessible name for the stage, e.g. "Music visualizer". Not drawn -- the point of
   * this component is that nothing is drawn but the children.
   */
  label: string;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

export function FullscreenStage({
  children,
  onExit,
  label,
  className = "",
}: FullscreenStageProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Held in a ref so the effect below can stay keyed to mount alone. `onExit` is
  // usually an inline arrow, and depending on it directly would tear the stage down
  // and rebuild it on every parent render -- which, for a fullscreen request, means
  // the browser dropping out of fullscreen.
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;

    let isCurrent = true;

    // `requestFullscreen` rejects unless it is running inside a user gesture. Mounting
    // this component from a click handler satisfies that; mounting it from an effect
    // on page load does not, which is why a rejection reports an exit rather than
    // throwing -- the caller closes the stage and the viewer sees nothing odd.
    const request = host.requestFullscreen?.({ navigationUI: "hide" });
    void Promise.resolve(request).catch(() => {
      if (isCurrent) onExitRef.current();
    });

    // Fires for Escape, for the browser's own exit affordance, and for a
    // programmatic exit. One listener covers every way out.
    const onFullscreenChange = () => {
      if (document.fullscreenElement === null) onExitRef.current();
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);

    return () => {
      isCurrent = false;
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      // Unmounted while still fullscreen -- the caller closed the stage some other
      // way, so leave fullscreen with it rather than stranding the viewer there.
      if (document.fullscreenElement === host) void document.exitFullscreen?.();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      // Black rather than `--paper`: on a stage the surrounding colour should
      // disappear, and `--paper` is a near-black that reads as a panel next to a
      // genuinely black screen.
      className={`flex h-full w-full items-center justify-center bg-black ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * Whether this browser will grant fullscreen at all.
 *
 * Exported because a caller should not offer a control that cannot work: iOS Safari on
 * iPhone has no element fullscreen, and a dead button is worse than no button.
 */
export function canGoFullscreen(): boolean {
  if (typeof document === "undefined") return false;
  return document.fullscreenEnabled === true;
}
