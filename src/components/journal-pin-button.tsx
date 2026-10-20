"use client";

// The pinned toggle for one journal entry: a thumbtack that fills in when the entry
// is pinned. Shared because both entry forms carry it — New Journal Entry and the
// inline editor on an entry's own screen — and the two must not drift into a solid
// peg on one and a hollow one on the other.
//
// Pure presentation. It raises intent and renders the state it is handed; whether a
// pin is held in form state until Save or written straight through is the caller's
// decision, and today both callers hold it until Save.

import { TreeIcon } from "@/components/tree-icons";

export interface JournalPinButtonProps {
  /** Whether the entry is currently pinned — drives the fill and the label. */
  isPinned: boolean;
  /** Raised on click. The caller flips its own state; this component holds none. */
  onToggle: () => void;
  /** Greyed while the form it sits on is saving. */
  disabled?: boolean;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

export function JournalPinButton({
  isPinned,
  onToggle,
  disabled = false,
  className = "",
}: JournalPinButtonProps) {
  const label = isPinned ? "Unpin this entry" : "Pin this entry";

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      // `aria-pressed` rather than a checkbox role: this is a toggle button, and it
      // replaced a real checkbox whose label a screen reader used to read out. Without
      // this the pressed state would be announced by the glyph alone, i.e. not at all.
      aria-pressed={isPinned}
      title={label}
      aria-label={label}
      className={`shrink-0 rounded-md p-1 text-brass hover:text-brass-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass disabled:opacity-50 ${className}`}
    >
      {/* Outline vs solid carries the state; both glyphs are the same silhouette so the
          press reads as a fill, not a swap. Same rule as the favourite star. */}
      <TreeIcon name={isPinned ? "pushpin-filled" : "pushpin"} className="h-5 w-5" />
    </button>
  );
}
