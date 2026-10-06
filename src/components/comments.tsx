"use client";

// A note or instruction parked next to a feature: a small accent glyph that
// opens the text in a dialog. For guidance that a reader wants
// once and then never again — the mark costs a line of nothing, where the same
// copy inline pushes the actual feature down the page.
//
// Pure presentation. The dialog is `Modal`, so Escape, the overlay click, the
// focus trap and the scroll lock all come for free; the only state here is
// whether it's open. `content` is a prop, never fetched.

import { useState, type ReactNode } from "react";

import { Modal } from "@/components/modal";
import { SlotIcon } from "@/components/slot-icon";
import { TreeIcon } from "@/components/tree-icons";
import { getIconSlot } from "@/lib/icons";

/**
 * The chip's glyph. Slotted only for the default `info` mark.
 *
 * A caller that asked for `note` or `clip` chose that glyph deliberately to say something
 * different, so silently redirecting it through the "help chip" slot would let one upload
 * overwrite three distinct meanings. Every current call site takes the default.
 */
function HelpChipIcon({ icon, className }: { icon: Icon; className?: string }) {
  const slot = icon === "info" ? getIconSlot("chrome_help_chip") : undefined;
  if (slot) return <SlotIcon slot={slot} className={className} />;
  return <TreeIcon name={icon} className={className} />;
}

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
   * Text beside the glyph. **No call site passes this today** — every mark is
   * glyph-only, with `title` carrying the wording as a hover hint ("Explanation",
   * "About", "Instruction") and as the accessible name. Kept for the case where a
   * mark is genuinely too easy to miss on its own, but reach for it knowingly: a
   * visible word next to the glyph is what made these read as buttons before.
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
        // A bare accent glyph, not a filled badge and not a Button: this sits
        // beside a heading as an aside, so it carries no fill, no padding and
        // no shadow — either would read as the section's own control. The mark
        // is the smallest thing on the line and stays out of the way until
        // someone reaches for it.
        //
        // The visible mark is 14px, well under a thumb. The `after:` overlay
        // restores a 44px hit area on compact without occupying 44px of layout,
        // so neighbours don't get pushed around. `lg:after:hidden` drops it for
        // a pointer, where an invisible box that much larger than its glyph
        // would swallow clicks meant for whatever sits alongside.
        className={`relative inline-flex shrink-0 items-center gap-1 rounded-sm text-xs font-medium text-brass transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass focus-visible:ring-offset-2 focus-visible:ring-offset-paper after:absolute after:left-1/2 after:top-1/2 after:h-11 after:w-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] lg:after:hidden ${className}`}
      >
        <HelpChipIcon icon={icon} className="h-3.5 w-3.5" />
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
