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

import { useEffect, useId, useRef, type ReactNode } from "react";

type Size = "sm" | "md" | "lg" | "full";

export interface ModalProps {
  /** Heading text, announced as the dialog's accessible name. */
  title: string;
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
  /** Panel width. Defaults to "md". */
  size?: Size;
  /**
   * Set while an action is in flight to suppress the casual dismissals
   * (Escape, overlay click, the ✕) so a half-finished write can't be orphaned.
   * The footer's own buttons stay the caller's responsibility.
   */
  isBusy?: boolean;
  /** Caller-supplied classes for the panel, merged last so they win. */
  className?: string;
}

const sizeClasses: Record<Size, string> = {
  sm: "max-w-md",
  md: "max-w-2xl",
  lg: "max-w-4xl",
  // Edge to edge: no width cap, no rounding, and the overlay drops its gutter
  // below so nothing of the page shows around it. Still a dialog — Escape, the
  // ✕ and the focus trap all behave the same, so it returns you to the screen
  // underneath rather than being a route you have to navigate back from.
  full: "h-full max-w-none rounded-none",
};

/** Elements that can hold focus inside the panel, for the focus trap. */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  title,
  description,
  children,
  footer,
  onClose,
  size = "md",
  isBusy = false,
  className = "",
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

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
      if (event.key !== "Tab") return;

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
  }, [onClose, isBusy]);

  // The page behind must not scroll while a modal is up, or the overlay slides
  // off the viewport on a short screen.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 ${
        size === "full" ? "p-0" : "p-4"
      }`}
      // A click that starts inside the panel and ends on the overlay (a drag off
      // a text selection) shouldn't dismiss, so this only fires for the overlay
      // itself, not for anything bubbling out of the panel.
      onClick={(event) => {
        if (event.target === event.currentTarget && !isBusy) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`flex max-h-full w-full ${sizeClasses[size]} flex-col overflow-hidden rounded-xl border border-line bg-paper-raised focus-visible:outline-none ${className}`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h3 id={titleId} className="font-display text-lg text-ink">
              {title}
            </h3>
            {description && (
              <p id={descriptionId} className="mt-1 text-sm text-muted">
                {description}
              </p>
            )}
          </div>
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
