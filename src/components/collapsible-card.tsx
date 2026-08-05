"use client";

import { useState, type ReactNode } from "react";

export interface CollapsibleCardProps {
  /** Header text, always visible. */
  title: string;
  /** Whether the body starts expanded. Ignored when `open` is supplied. */
  defaultOpen?: boolean;
  /**
   * Supply this (with `onOpenChange`) to drive the card from outside — e.g. to pop
   * it open when a background job starts so its progress isn't hidden. Omit both and
   * the card manages its own state from `defaultOpen`.
   */
  open?: boolean;
  /** Raised with the state the card is moving to. Required for controlled use. */
  onOpenChange?: (open: boolean) => void;
  /**
   * Rendered on the title line, to the left of the chevron, and **always visible**
   * — for an action that belongs to the card as a whole rather than to its body.
   * It sits outside the toggle, so clicking it doesn't expand or collapse the card
   * (a button inside a button isn't valid markup, which is why this is a slot).
   */
  headerAction?: ReactNode;
  /** Body content, shown when expanded. */
  children: ReactNode;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

export function CollapsibleCard({
  title,
  defaultOpen = false,
  open,
  onOpenChange,
  headerAction,
  children,
  className = "",
}: CollapsibleCardProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : uncontrolledOpen;

  function toggle() {
    const next = !isOpen;
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  }

  return (
    <div className={`rounded-xl border border-line bg-paper-raised ${className}`}>
      {/* A row rather than one big button, so `headerAction` can hold a real button. */}
      <div className="flex items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={isOpen}
          className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left text-sm font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        >
          <span className="truncate">{title}</span>
          <span
            className={`shrink-0 text-muted transition-transform motion-reduce:transition-none ${
              isOpen ? "rotate-90" : ""
            }`}
            aria-hidden
          >
            &rsaquo;
          </span>
        </button>
        {headerAction && <div className="shrink-0">{headerAction}</div>}
      </div>
      {isOpen && <div className="border-t border-line px-4 py-4">{children}</div>}
    </div>
  );
}
