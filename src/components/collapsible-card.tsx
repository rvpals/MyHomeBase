"use client";

import { useState, type ReactNode } from "react";

export interface CollapsibleCardProps {
  /** Header text, always visible. */
  title: string;
  /** Whether the body starts expanded. */
  defaultOpen?: boolean;
  /** Body content, shown when expanded. */
  children: ReactNode;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

export function CollapsibleCard({
  title,
  defaultOpen = false,
  children,
  className = "",
}: CollapsibleCardProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`rounded-xl border border-line bg-paper-raised ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
      >
        <span className="truncate">{title}</span>
        <span
          className={`shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`}
          aria-hidden
        >
          &rsaquo;
        </span>
      </button>
      {open && <div className="border-t border-line px-4 py-4">{children}</div>}
    </div>
  );
}
