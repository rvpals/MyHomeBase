"use client";

// A note or instruction parked next to a feature: a small info chip that opens
// the text in a dialog. For guidance that a reader wants
// once and then never again — the chip costs a line of nothing, where the same
// copy inline pushes the actual feature down the page.
//
// Pure presentation. The dialog is `Modal`, so Escape, the overlay click, the
// focus trap and the scroll lock all come for free; the only state here is
// whether it's open. `content` is a prop, never fetched.

import { useState, type ReactNode } from "react";

import { Modal } from "@/components/modal";
import { TreeIcon } from "@/components/tree-icons";

type Icon = "info" | "note" | "clip";

export interface CommentsProps {
  /**
   * The dialog's heading, and the chip's accessible name when there's no
   * visible `label`. "Note", "Instructions", "How this works" — whatever names
   * the thing being explained.
   */
  title: string;
  /**
   * The note itself. `ReactNode` rather than `string` so a note can carry a
   * list or emphasis; a plain string is the common case and works as-is.
   */
  content: ReactNode;
  /**
   * Text beside the glyph. Omit for an icon-only chip — `title` still names it
   * for a screen reader.
   */
  label?: string;
  /**
   * Which glyph. Default `"info"` — the circled "i" is the near-universal mark
   * for "explanatory text lives here", so it needs no learning. `"note"` (a
   * sticky note) and `"clip"` (a paper clip) are there for the cases where the
   * content is genuinely a jotting or an attachment rather than an explanation.
   */
  icon?: Icon;
  /** Dialog width, forwarded to `Modal`. Default `"sm"` — a note is short. */
  size?: "sm" | "md";
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

export function Comments({
  title,
  content,
  label,
  icon = "info",
  size = "sm",
  className = "",
}: CommentsProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        title={title}
        aria-label={label ? undefined : title}
        aria-expanded={isOpen}
        // The chip is the low-emphasis tinted badge from design.md, not a
        // Button: this sits beside a heading as an aside, and the hard offset
        // shadow would read as the section's primary action.
        //
        // `py-1.5` on a 16px glyph lands the hit area near the 44px comfortable
        // tap target without making the chip look oversized on a desktop.
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-md bg-brass-soft px-2 py-1.5 text-xs font-medium text-brass-dark transition-colors hover:bg-brass hover:text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${className}`}
      >
        <TreeIcon name={icon} className="h-4 w-4" />
        {label && <span>{label}</span>}
      </button>

      {isOpen && (
        <Modal title={title} size={size} onClose={() => setIsOpen(false)}>
          <div className="flex flex-col gap-2 text-sm text-muted">{content}</div>
        </Modal>
      )}
    </>
  );
}
