"use client";

// Reusable modal shell: the dimmed overlay, the centred panel, a title, and the
// keyboard/focus behaviour every dialog needs. Promoted from three hand-rolled
// overlays that each had to re-solve Escape-to-close and focus handling (the
// DataGrid "Show SQL" dialog, the DataGrid record view, and the Expense
// bulk-edit dialog) — see components.md before hand-rolling a fourth.
//
// Pure presentation: it owns no open/closed state. The caller decides whether to
// render it at all and supplies `onClose`; the body and the footer actions are
// children.

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

type Size = "sm" | "md" | "lg" | "full" | "window";

/**
 * How much of a dragged panel must stay on screen, in pixels.
 *
 * A window dragged fully past an edge can't be dragged back — the handle goes
 * with it — so the header is always kept reachable. Horizontally that's a strip
 * wide enough to grab; vertically the header's own height, and never above the
 * top edge at all.
 */
const KEEP_VISIBLE_X = 140;
const KEEP_VISIBLE_Y = 52;

export interface ModalProps {
  /** Heading text, announced as the dialog's accessible name. */
  title: string;
  /**
   * Optional glyph shown left of the title, for a dialog that *is* a place — the
   * Arcade's game boards badge themselves with the game's icon.
   *
   * Deliberately separate from `title`, which stays a `string` because it is the
   * dialog's accessible name via `aria-labelledby`. Letting a caller pass a node there
   * would have put the icon's markup inside the accessible name instead of beside it.
   */
  titleIcon?: ReactNode;
  /** Optional sub-heading under the title — context, not actions. */
  description?: ReactNode;
  /** The dialog body. */
  children: ReactNode;
  /**
   * Buttons for the bottom-right action bar (Cancel / Save …). Rendered in a
   * row, so pass `Button`s in the order they should read.
   */
  footer?: ReactNode;
  /**
   * Called on Escape, on an overlay click, and from the close button. The caller
   * stops rendering the modal — this component never closes itself.
   */
  onClose: () => void;
  /**
   * Panel size. Defaults to "md".
   *
   * `"window"` is the floating variant: **sized to its content** (capped at 56rem
   * wide and 85vh tall), draggable by its header, with a maximize button that swaps
   * it to the full-bleed treatment and back. Still a dialog — the overlay, Escape,
   * the focus trap and the scroll lock all behave exactly as they do at every other
   * size, unless `isNonModal` lifts them.
   */
  size?: Size;
  /**
   * Set while an action is in flight to suppress the casual dismissals
   * (Escape, overlay click, the ✕) so a half-finished write can't be orphaned.
   * The footer's own buttons stay the caller's responsibility.
   */
  isBusy?: boolean;
  /**
   * When supplied, the header grows a `_` button left of maximize, giving the
   * window-chrome trio `_ ▢ ✕`. For a dialog that shrinks to a puck rather than
   * closing — see [`FloatingWindow`](components.md#floatinglayer).
   *
   * Optional because minimizing is meaningless for most dialogs: a confirmation
   * you can park is one you can lose. A modal without it keeps exactly the header
   * it has today.
   */
  onMinimize?: () => void;
  /**
   * Drops the dimmed overlay, so the page behind stays visible *and* usable.
   *
   * For the floating layer only. A floating clock is not a dialog you answer and
   * dismiss — it sits over your work while you keep working, so scrimming the page
   * and trapping focus would make it a modal interruption instead of an accessory.
   * With this set the scroll lock and the focus trap are lifted too, and the panel
   * is announced as a non-modal dialog. Escape and the ✕ still close it.
   */
  isNonModal?: boolean;
  /** Caller-supplied classes for the panel, merged last so they win. */
  className?: string;
}

// Width/height per size. These carry the whole box, rather than sharing a
// `w-full` on the panel — two competing width utilities in one class string
// resolve by stylesheet order, not by the order they're written, which is not
// something to leave to chance.
const sizeClasses: Record<Size, string> = {
  sm: "max-h-full w-full max-w-md",
  md: "max-h-full w-full max-w-2xl",
  lg: "max-h-full w-full max-w-4xl",
  // Edge to edge: no width cap, no rounding, and the overlay drops its gutter
  // below so nothing of the page shows around it. Still a dialog — Escape, the
  // ✕ and the focus trap all behave the same, so it returns you to the screen
  // underneath rather than being a route you have to navigate back from.
  full: "h-full max-h-full w-full max-w-none rounded-none",
  // A floating window **sizes to its content**, capped so it can never outgrow the
  // viewport. Deliberately not `h-[80vh] w-[80vw]`, which is what it used to be: a
  // fixed 80% box left a clock with four lines of content sitting in an acre of empty
  // panel, because nothing about the content could shrink it. The cap is what a
  // *reading* surface wants and the floor stops a one-word window collapsing to its
  // title bar; between the two, the content decides.
  //
  // A caller that genuinely wants a different shape still passes `className` — it is
  // merged last, so `lg:w-[22rem]` wins over this.
  window: "h-auto max-h-[85vh] w-auto min-w-[20rem] max-w-[min(56rem,92vw)]",
};

/** Elements that can hold focus inside the panel, for the focus trap. */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  title,
  titleIcon,
  description,
  children,
  footer,
  onClose,
  size = "md",
  isBusy = false,
  onMinimize,
  isNonModal = false,
  className = "",
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  // Both reset every time the dialog mounts: the host keys the viewer by ticker,
  // and a window that reopened where you last shoved it — possibly maximized —
  // would be a surprise rather than a convenience.
  const [isMaximized, setIsMaximized] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const isFloating = size === "window";
  const isDraggable = isFloating && !isMaximized;
  // A maximized floating window *is* the full-bleed treatment, reusing it rather
  // than approximating it.
  const effectiveSize: Size = isFloating && isMaximized ? "full" : size;

  /**
   * Where the panel would sit with no offset, plus the pointer's grab point.
   * Captured once per drag: reading the rect mid-drag would compound the
   * transform that's already applied.
   */
  const drag = useRef<{
    pointerId: number;
    pointerX: number;
    pointerY: number;
    originX: number;
    originY: number;
    baseLeft: number;
    baseTop: number;
    width: number;
    height: number;
  } | null>(null);

  const clamp = useCallback(
    (x: number, y: number, base: { baseLeft: number; baseTop: number; width: number; height: number }) => ({
      x: Math.min(
        Math.max(x, -(base.baseLeft + base.width - KEEP_VISIBLE_X)),
        window.innerWidth - KEEP_VISIBLE_X - base.baseLeft,
      ),
      // Never above the viewport top — the header is the only handle, so losing
      // it upward is unrecoverable in a way losing the bottom edge is not.
      y: Math.min(
        Math.max(y, -base.baseTop),
        window.innerHeight - KEEP_VISIBLE_Y - base.baseTop,
      ),
    }),
    [],
  );

  function handleDragStart(event: React.PointerEvent<HTMLDivElement>) {
    if (!isDraggable) return;
    // The header carries the close and maximize buttons; a press on either is a
    // click, not the start of a drag.
    if ((event.target as HTMLElement).closest("button, a, input, select, textarea")) return;

    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;

    drag.current = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      originX: offset.x,
      originY: offset.y,
      baseLeft: rect.left - offset.x,
      baseTop: rect.top - offset.y,
      width: rect.width,
      height: rect.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleDragMove(event: React.PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;

    setOffset(
      clamp(
        state.originX + (event.clientX - state.pointerX),
        state.originY + (event.clientY - state.pointerY),
        state,
      ),
    );
  }

  function handleDragEnd(event: React.PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  // A window parked near an edge can end up off-screen when the viewport shrinks.
  // Re-centring is blunt but always recoverable, which clamping to a rect that
  // may itself have changed size is not.
  useEffect(() => {
    if (!isFloating) return;
    function recentre() {
      setOffset({ x: 0, y: 0 });
    }
    window.addEventListener("resize", recentre);
    return () => window.removeEventListener("resize", recentre);
  }, [isFloating]);

  // Move focus into the panel on open and put it back where it was on close —
  // without this, dismissing a dialog drops the caret at the top of the page.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const firstFocusable = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (firstFocusable ?? panelRef.current)?.focus();
    return () => previouslyFocused?.focus?.();
  }, []);

  // Escape closes; Tab cycles within the panel rather than escaping to the page
  // behind, which is still fully rendered underneath.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isBusy) {
        event.stopPropagation();
        onClose();
        return;
      }
      // A non-modal panel does not trap Tab: the page behind is still usable, so
      // holding focus inside would strand a keyboard reader in a clock they can't
      // tab out of.
      if (event.key !== "Tab" || isNonModal) return;

      const focusable = [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose, isBusy, isNonModal]);

  // The page behind must not scroll while a modal is up, or the overlay slides
  // off the viewport on a short screen. A non-modal panel has no overlay and the
  // page behind is meant to stay usable, so it leaves the scroll alone.
  useEffect(() => {
    if (isNonModal) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isNonModal]);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center ${
        // No scrim and no pointer capture when non-modal: the container still spans
        // the viewport so the panel can be centred, but clicks fall through to the
        // page, which stays usable. The panel itself takes pointer events back.
        isNonModal ? "pointer-events-none" : "bg-black/60"
      } ${effectiveSize === "full" ? "p-0" : "p-4"}`}
      // A click that starts inside the panel and ends on the overlay (a drag off
      // a text selection) shouldn't dismiss, so this only fires for the overlay
      // itself, not for anything bubbling out of the panel.
      onClick={(event) => {
        // A non-modal panel has no overlay to click, so there is nothing to dismiss
        // on: the reader is expected to keep using the page behind it.
        if (isNonModal) return;
        if (event.target === event.currentTarget && !isBusy) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal={isNonModal ? undefined : "true"}
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        // The offset is a transform rather than left/top so dragging never
        // triggers layout — the panel holds tables and a chart, and reflowing
        // those on every pointer move would crawl.
        style={
          offset.x !== 0 || offset.y !== 0
            ? { transform: `translate(${offset.x}px, ${offset.y}px)` }
            : undefined
        }
        className={`flex ${sizeClasses[effectiveSize]} flex-col overflow-hidden rounded-xl border border-line bg-paper-raised focus-visible:outline-none ${
          // The panel takes pointer events back from the see-through container, and
          // a non-modal panel gets a real lift: with no scrim behind it, a hairline
          // border alone doesn't separate it from the page it's floating over.
          isNonModal ? "pointer-events-auto card-raised" : ""
        } ${className}`}
      >
        <div
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
          className={`flex items-start justify-between gap-3 border-b border-line px-4 py-3 ${
            isDraggable
              ? // `touch-none` stops a drag from scrolling the page on a
                // touchscreen; `select-none` stops it selecting the title text.
                "cursor-grab touch-none select-none active:cursor-grabbing"
              : ""
          }`}
        >
          <div>
            <h3 id={titleId} className="flex items-center gap-2 font-display text-lg text-ink">
              {titleIcon}
              {title}
            </h3>
            {description && (
              <p id={descriptionId} className="mt-1 text-sm text-muted">
                {description}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {/* Window-chrome order, `_ ▢ ✕`, matching MusicPlayerBar's two buttons
                and every desktop window the reader has ever used. Minimize first
                because it is the least destructive of the three. */}
            {onMinimize && (
              <button
                type="button"
                onClick={onMinimize}
                aria-label="Minimize"
                title="Minimize"
                className="rounded-md p-1 text-muted transition-colors hover:bg-brass-soft hover:text-brass-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  className="h-4 w-4"
                  aria-hidden="true"
                >
                  {/* A low underscore, the universal minimize mark. */}
                  <path d="M6 18h12" />
                </svg>
              </button>
            )}
            {isFloating && (
              <button
                type="button"
                onClick={() => {
                  // Dropping the offset matters: a maximized panel fills the
                  // viewport, so a leftover translate would push it off-screen.
                  setOffset({ x: 0, y: 0 });
                  setIsMaximized((maximized) => !maximized);
                }}
                aria-pressed={isMaximized}
                aria-label={isMaximized ? "Restore down" : "Maximize"}
                title={isMaximized ? "Restore down" : "Maximize"}
                className="rounded-md p-1 text-muted transition-colors hover:bg-brass-soft hover:text-brass-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                  aria-hidden="true"
                >
                  {isMaximized ? (
                    // Arrows pointing in — "make this smaller again".
                    <path d="M10 4v6H4M14 20v-6h6M10 10L3 3M14 14l7 7" />
                  ) : (
                    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                  )}
                </svg>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={isBusy}
              aria-label="Close"
              title="Close"
              className="rounded-md p-1 text-muted transition-colors hover:bg-brass-soft hover:text-brass-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass disabled:opacity-40"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Only the body scrolls, so the title and the actions stay reachable
            however long the content is. */}
        <div className="flex-1 overflow-auto px-4 py-4">{children}</div>

        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
