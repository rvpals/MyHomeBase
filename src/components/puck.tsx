"use client";

// The small round target a minimised bar leaves behind.
//
// Lived inside `app-chrome.tsx` while the top bar and the module bar were the
// only two things that minimised. The compact section tree is the third, and a
// third copy of the same circle is how two of them quietly drift apart.
//
// Placement is the caller's, including the stacking order: `AppChrome`'s bars sit
// at `z-40` and their pucks go with them, while the section tree's bar and puck
// are both `z-30`. Passing that in beats a default here that every caller has to
// fight — there's no `tailwind-merge` in this project, so a `z-30` arriving after
// a built-in `z-40` wouldn't reliably win.

export interface PuckProps {
  onClick: () => void;
  /** Both the tooltip and the accessible name — it's an icon-only button. */
  label: string;
  /** Placement and stacking utilities, e.g. `"left-3 top-3 z-40"`. */
  position: string;
  children: React.ReactNode;
  className?: string;
}

export function Puck({ onClick, label, position, children, className = "" }: PuckProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`fixed ${position} flex h-11 w-11 items-center justify-center rounded-full border border-line bg-paper-raised text-brass-dark shadow-[0_6px_18px_-6px_rgba(0,0,0,0.45)] transition-colors hover:bg-brass-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${className}`}
    >
      {children}
    </button>
  );
}
