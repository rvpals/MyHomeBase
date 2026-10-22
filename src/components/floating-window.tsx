"use client";

// The two shapes a floating component takes: the window card, and the puck it shrinks
// to. Both are pure presentation — the state lives in `FloatingLayerProvider` and the
// rules live in `src/lib/floating`.
//
// `FloatingWindow` is deliberately a thin wrapper over `Modal size="window"` rather than
// a second draggable panel. That variant already solves dragging, clamping to the
// viewport, maximize/restore, Escape and focus return; re-implementing it here is
// exactly the "parallel implementation" components.md warns against. What this adds is
// the `_` button, the non-modal treatment, and the compact fork.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Modal } from "@/components/modal";
import { clampPuckPosition, type PuckCorner, type PuckPosition } from "@/lib/floating";
import { useIsCompact } from "@/components/viewport-context";

/**
 * How far the pointer must travel before a press becomes a drag, in pixels.
 *
 * The puck is unusual among this app's draggable things: it is its own handle *and*
 * its own button, because a 56px circle has no room for a separate grip the way
 * `PersonalToolbars` does. So the gesture has to be disambiguated by distance — under
 * the threshold the press is a tap and restores the window, over it the press is a
 * drag and the click is suppressed.
 *
 * 4px rather than 0, because a mouse drifts a pixel or two during an ordinary click
 * and a touch wanders more; a 0px threshold would make the puck nearly impossible to
 * simply tap. Small enough that a deliberate drag still feels immediate.
 */
const DRAG_THRESHOLD = 4;

export interface FloatingWindowProps {
  /** Heading text, and the window's accessible name. */
  title: string;
  /** Optional glyph left of the title — a floating component *is* a place. */
  titleIcon?: ReactNode;
  children: ReactNode;
  /** `X` — gone until the reader turns it back on in Account. */
  onClose: () => void;
  /** `_` — shrink to the puck, still running. */
  onMinimize: () => void;
  className?: string;
}

export function FloatingWindow({
  title,
  titleIcon,
  children,
  onClose,
  onMinimize,
  className = "",
}: FloatingWindowProps) {
  const isCompact = useIsCompact();

  return (
    <Modal
      title={title}
      titleIcon={titleIcon}
      onClose={onClose}
      onMinimize={onMinimize}
      // On a phone a draggable 80vw window is a worse full-screen sheet: there is
      // nowhere to drag it *to*, and the drag competes with the page's own scroll.
      // `full` is the edge-to-edge treatment Modal already ships, so compact gets a
      // proper sheet and desktop gets the floating window. This is the genuine
      // component fork design.md sanctions — a restyle couldn't change the drag.
      size={isCompact ? "full" : "window"}
      // Desktop only: a floating accessory you can work around. The compact sheet
      // covers the screen anyway, so leaving it modal there is honest — and it keeps
      // the scrim that separates it from the page behind.
      isNonModal={!isCompact}
      className={className}
    >
      {children}
    </Modal>
  );
}

/**
 * The puck's drag gesture: pointer handling, the tap/drag threshold, and the clamp.
 *
 * Modelled on `useToolbarDrag` in `personal-toolbar.tsx` — the same problem, solved
 * the same way, deliberately. The clamp itself lives in `lib` (`clampPuckPosition`)
 * and is tested there; this hook only measures the DOM and hands it numbers.
 *
 * Two things differ from the toolbar's, both because of the puck's shape:
 *
 * 1. **There is no grip.** The whole puck is the handle, so `DRAG_THRESHOLD` is what
 *    separates a move from a tap, and `didDrag` lets the click handler bow out.
 * 2. **A puck may have no position at all.** An undragged one is placed by the CSS
 *    corner rules, which read live values this hook cannot see. So `position` is
 *    nullable, and the first drag has to measure where the puck actually *is* before
 *    it can start moving it — `originX/Y` comes from the rect, not from a prop.
 */
function usePuckDrag({
  enabled,
  position,
  onCommit,
}: {
  enabled: boolean;
  /** The reader's stored position, or `null` when the puck is still corner-docked. */
  position: PuckPosition | null;
  onCommit: (position: PuckPosition) => void;
}) {
  const puckRef = useRef<HTMLDivElement>(null);
  const [dragged, setDragged] = useState<PuckPosition | null>(null);
  // State rather than only the ref, because this drives `data-dragging` in the markup
  // and a ref read does not re-render — the attribute would never appear and the puck
  // would ease along behind the pointer for the whole gesture.
  const [isDragging, setIsDragging] = useState(false);

  /**
   * Whether the pointer passed the threshold during this gesture.
   *
   * A ref, not state: it is read by the click handler that fires immediately after
   * `pointerup`, and a state update would not have been applied yet.
   */
  const didDrag = useRef(false);

  /**
   * What this component last committed — see `useToolbarDrag`'s note, which applies
   * verbatim. The save deliberately does not revalidate, so the prop keeps the old
   * position for the rest of the page's life and "they differ" does not imply the
   * server has something newer.
   */
  const committed = useRef<PuckPosition | null>(null);

  /** Captured once per drag: re-reading the rect mid-drag compounds the move. */
  const drag = useRef<{
    pointerId: number;
    pointerX: number;
    pointerY: number;
    originX: number;
    originY: number;
    width: number;
    height: number;
  } | null>(null);

  // The live position: the in-flight drag if there is one, else the stored one, else
  // `null` meaning "leave it to the corner rules".
  const current = dragged ?? position;

  const clampHere = useCallback((point: PuckPosition, width: number, height: number) => {
    return clampPuckPosition(
      point,
      { width, height },
      { width: window.innerWidth, height: window.innerHeight },
    );
  }, []);

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!enabled) return;
    // The shoulder ✕ is a button, not a handle: pressing it must close the puck, not
    // pick it up. Same exclusion `Modal`'s header drag makes for its own chrome.
    if ((event.target as HTMLElement).closest("button")?.dataset.puckClose !== undefined) {
      return;
    }

    const rect = puckRef.current?.getBoundingClientRect();
    if (!rect) return;

    drag.current = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      // Measured, not taken from `current`: an undragged puck has no stored position,
      // and where it sits is known only to the CSS corner rules. The rect is the one
      // place both cases agree.
      originX: rect.left,
      originY: rect.top,
      width: rect.width,
      height: rect.height,
    };
    didDrag.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;

    const dx = event.clientX - state.pointerX;
    const dy = event.clientY - state.pointerY;

    // Below the threshold this is still a tap in progress — nothing moves, and the
    // click that follows will restore the window as usual.
    if (!didDrag.current && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!didDrag.current) {
      didDrag.current = true;
      setIsDragging(true);
    }

    setDragged(
      clampHere(
        { x: state.originX + dx, y: state.originY + dy },
        state.width,
        state.height,
      ),
    );
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (state?.pointerId !== event.pointerId) return;
    drag.current = null;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    // Once, on release — not per move, which would be a server action per frame.
    // `setDragged(null)` is deliberately NOT called: the dropped position is what the
    // reader is looking at, and falling back to the prop before the save lands would
    // snap the puck back to where it started. The effect below releases it, and only
    // once the server's value agrees.
    if (didDrag.current && dragged) {
      committed.current = dragged;
      onCommit(dragged);
    }
  }

  useEffect(() => {
    // Mid-gesture, nothing from the server may move the puck.
    if (drag.current) return;

    const mine = committed.current;
    const isOurOwnEcho =
      mine !== null && position !== null && mine.x === position.x && mine.y === position.y;
    if (isOurOwnEcho) {
      // The server caught up with what we already drew. Release the local override so
      // the prop drives from here on; the pixels do not change.
      committed.current = null;
      setDragged(null);
      return;
    }

    // A position we did not write — a reset from Account, another tab, a fresh load.
    // It wins. This is also the path that returns a puck to its corner: `position`
    // becomes `null` and the local override has to go with it, or the puck would
    // stay where it was dropped and the reset would appear to do nothing.
    if (mine === null) {
      setDragged(null);
    }
  }, [position]);

  // A puck parked near an edge can end up off-screen when the window shrinks or the
  // device rotates. Clamped back rather than re-centred — a puck's whole value is
  // being where it was put, so the smallest correction that makes it reachable is the
  // right one. Deliberately NOT committed: narrowing a window for a moment must not
  // permanently rewrite a desktop position.
  //
  // Only for a puck that HAS a position. An undocked one is the CSS's business, and
  // its corner rules already account for the safe-area insets and the panel widths.
  useEffect(() => {
    if (!enabled || position === null) return;

    function pullBack() {
      const rect = puckRef.current?.getBoundingClientRect();
      if (!rect) return;
      setDragged((previous) => {
        const from = previous ?? position;
        if (from === null) return previous;
        const next = clampPuckPosition(
          from,
          { width: rect.width, height: rect.height },
          { width: window.innerWidth, height: window.innerHeight },
        );
        return next.x === from.x && next.y === from.y ? previous : next;
      });
    }

    window.addEventListener("resize", pullBack);
    pullBack();
    return () => window.removeEventListener("resize", pullBack);
    // On the coordinates, not the object: a caller may build `position` during render,
    // so depending on the reference would re-add the listener on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, position?.x, position?.y]);

  return {
    puckRef,
    position: current,
    isDragging,
    /** Whether the gesture just ended was a drag — the click handler checks this. */
    didDrag,
    handlers: enabled
      ? {
          onPointerDown: handlePointerDown,
          onPointerMove: handlePointerMove,
          onPointerUp: handlePointerUp,
          onPointerCancel: handlePointerUp,
        }
      : {},
  };
}

export interface FloatingPuckProps {
  /** Tooltip and accessible name — "Floating Clock". */
  label: string;
  /**
   * Where this puck parks: 0 is nearest the corner. From `resolvePuckSlots`, which is
   * what keeps a floating puck off the music player's.
   */
  index: number;
  /**
   * Which corner to dock in — the reader's per-component choice, also from
   * `resolvePuckSlots`. Applied as a `data-corner` attribute that `.floating-puck`
   * reads; the offsets live in CSS, because a pixel edge inset is not something `lib`
   * or this component should be computing.
   */
  corner: PuckCorner;
  /** The small image itself — a live clock face, cover art, whatever the component is. */
  children: ReactNode;
  /** Tapping the puck restores the window. */
  onRestore: () => void;
  /** `X` on the puck means the same as `X` on the window: gone. */
  onClose: () => void;
  /**
   * Where this reader has dragged the puck, or `undefined` while it is still docked.
   *
   * `undefined` is not "the origin" — it means *this component should not position
   * the puck at all*, leaving it to the corner rules in `globals.css`, which resolve
   * against live values (`--section-panel-width`, `env(safe-area-inset-*)`) that no
   * number passed from here could stand in for.
   */
  position?: PuckPosition;
  /**
   * Remembers where the puck was dropped. Absent means the puck is not draggable —
   * which is how compact gets the docked behaviour, since the mount site decides.
   */
  onMove?: (position: PuckPosition) => void;
  className?: string;
}

/**
 * The minimized puck: a small round button showing a live image of the component.
 *
 * Positioning is entirely `.floating-puck`'s. This file sets only the local numbers it
 * reads — `--floating-puck-index` for a docked puck, `--floating-puck-x/y` for a
 * dragged one — which is the named-class-plus-local-number idiom design.md describes.
 * No `fixed` offset is written here, and that is the rule that keeps two pucks from
 * ending up on top of each other.
 *
 * The two placements are exclusive, and the attributes enforce it: a dragged puck drops
 * `data-corner` and takes `data-floating-pos`, so the corner rules simply do not match
 * it and there is nothing for the inline position to fight.
 */
export function FloatingPuck({
  label,
  index,
  corner,
  children,
  onRestore,
  onClose,
  position,
  onMove,
  className = "",
}: FloatingPuckProps) {
  // Dragging is desktop-only, the same fork `Modal` makes and for the same reasons:
  // on a phone `touch-none` on a 56px target sitting over the page would eat the
  // scroll a reader expects, and there is little room to drag to. A compact reader
  // still moves the puck between corners on the Account screen.
  const isCompact = useIsCompact();
  const canDrag = onMove !== undefined && !isCompact;

  const { puckRef, position: livePosition, isDragging, didDrag, handlers } = usePuckDrag({
    enabled: canDrag,
    position: position ?? null,
    onCommit: (next) => onMove?.(next),
  });

  // Which side the shoulder close button sits on: outward, away from the screen edge,
  // so it is never clipped and never under a thumb reaching for the puck itself.
  //
  // A dragged puck has no corner to be outward *of*, so it takes the default
  // top-right placement rather than following `corner`, which by then describes where
  // it used to dock rather than where it is.
  const isLeft = !livePosition && (corner === "bottom-left" || corner === "top-left");
  const isTop = !livePosition && (corner === "top-right" || corner === "top-left");

  return (
    <div
      ref={puckRef}
      className={`floating-puck animate-floating-puck-in group ${className}`}
      // Dropped once the puck is freely placed: the corner rules in `globals.css` are
      // keyed off this attribute, and leaving it on would have them fight the inline
      // position. `data-floating-pos` is what the free-placement rule matches instead.
      data-corner={livePosition ? undefined : corner}
      data-floating-pos={livePosition ? "" : undefined}
      data-dragging={isDragging ? "" : undefined}
      style={
        livePosition
          ? ({
              "--floating-puck-x": `${livePosition.x}px`,
              "--floating-puck-y": `${livePosition.y}px`,
            } as React.CSSProperties)
          : ({ "--floating-puck-index": index } as React.CSSProperties)
      }
      {...handlers}
    >
      <button
        type="button"
        // A drag ends with a click on this button, so the gesture has to be told
        // apart from a tap — otherwise every drop would also reopen the window.
        // `didDrag` is a ref precisely because it is read here, synchronously, before
        // any state update from `pointerup` has been applied.
        onClick={() => {
          if (didDrag.current) {
            didDrag.current = false;
            return;
          }
          onRestore();
        }}
        aria-label={`${label} — restore`}
        title={canDrag ? `${label} — restore, or drag to move` : `${label} — restore`}
        // `touch-none` only while draggable: it stops a drag scrolling the page on a
        // touchscreen, but on compact — where the puck does not move — it would
        // needlessly swallow a scroll that began on the puck.
        // `active:` alongside `hover:` per design.md: a hover state is dead weight on
        // a touchscreen and can stick after a tap on iOS.
        className={`block h-14 w-14 overflow-hidden rounded-full border border-line bg-paper-raised card-raised transition-transform hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
          canDrag ? "cursor-grab touch-none select-none active:cursor-grabbing" : ""
        }`}
      >
        {children}
      </button>

      {/* The puck's own close. Sits on the shoulder of the button rather than inside
          it — a 14px target inside a 56px one is a mis-tap waiting to happen, and
          nesting a button inside a button is invalid HTML besides.

          Always rendered on a touch device (where there is no hover to reveal it) and
          revealed on hover/focus on a pointer device, so it doesn't clutter the corner.
          `focus-within` keeps it reachable by keyboard. */}
      <button
        type="button"
        onClick={onClose}
        // Read by the drag's `pointerdown`, which bails out on it: pressing the ✕
        // must close the puck, never pick it up.
        data-puck-close=""
        aria-label={`${label} — close`}
        title={`${label} — close`}
        className={`absolute rounded-full border border-line bg-paper p-1 text-muted opacity-0 transition-opacity hover:text-brass-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass group-hover:opacity-100 group-focus-within:opacity-100 max-lg:opacity-100 ${
          isLeft ? "-left-1" : "-right-1"
        } ${isTop ? "-bottom-1" : "-top-1"}`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          className="h-2.5 w-2.5"
          aria-hidden="true"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
