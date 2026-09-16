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

import type { ReactNode } from "react";
import { Modal } from "@/components/modal";
import type { PuckCorner } from "@/lib/floating";
import { useIsCompact } from "@/components/viewport-context";

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
  className?: string;
}

/**
 * The minimized puck: a small round button showing a live image of the component.
 *
 * Positioning is entirely `.floating-puck`'s, reading the `--floating-puck-index` set
 * inline here — the named-class-plus-local-number idiom design.md describes. Nothing in
 * this file writes a `fixed` offset of its own, which is the rule that keeps two bars
 * from ending up on top of each other.
 */
export function FloatingPuck({
  label,
  index,
  corner,
  children,
  onRestore,
  onClose,
  className = "",
}: FloatingPuckProps) {
  // Which side the shoulder close button sits on: outward, away from the screen edge,
  // so it is never clipped and never under a thumb reaching for the puck itself.
  const isLeft = corner === "bottom-left" || corner === "top-left";
  const isTop = corner === "top-right" || corner === "top-left";

  return (
    <div
      className={`floating-puck animate-floating-puck-in group ${className}`}
      data-corner={corner}
      style={{ "--floating-puck-index": index } as React.CSSProperties}
    >
      <button
        type="button"
        onClick={onRestore}
        aria-label={`${label} — restore`}
        title={`${label} — restore`}
        // `active:` alongside `hover:` per design.md: a hover state is dead weight on
        // a touchscreen and can stick after a tap on iOS.
        className="block h-14 w-14 overflow-hidden rounded-full border border-line bg-paper-raised card-raised transition-transform hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
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
