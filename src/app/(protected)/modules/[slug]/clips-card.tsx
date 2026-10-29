"use client";

// One clip as a card: its tint, its pin, its excerpt, its checklist and its chips.
//
// Shared by the board and the list — the two views differ in how cards are *laid
// out*, not in what a card is, so a second copy would be two places to fix a chip.
//
// It holds exactly one piece of state: which checklist items have been ticked since
// the page was rendered. Everything else is props in, events out.

import { useState } from "react";
import { Button } from "@/components/button";
import { JournalPinButton } from "@/components/journal-pin-button";
import { TreeIcon } from "@/components/tree-icons";
import { buildClipItemBoard, type ClipSummary } from "@/lib/clips";

/**
 * The tint class for a stored colour key.
 *
 * A lookup, not `clip-tint-${color}`: Tailwind and the CSS bundle are both scanned
 * as source text, so an interpolated class name is never emitted. It also means an
 * unrecognised key — a row from a newer build, or one hand-edited in the database —
 * draws the default surface instead of an unstyled card.
 */
const TINT_CLASS: Record<string, string> = {
  rose: "clip-tint clip-tint-rose",
  amber: "clip-tint clip-tint-amber",
  sage: "clip-tint clip-tint-sage",
  ocean: "clip-tint clip-tint-ocean",
  indigo: "clip-tint clip-tint-indigo",
  slate: "clip-tint clip-tint-slate",
};

export interface ClipsCardProps {
  clip: ClipSummary;
  /** Opens the full clip. */
  onOpen: (id: number) => void;
  /** Opens the editor. Absent for a sealed clip, which cannot be edited in place. */
  onEdit?: (id: number) => void;
  onDelete: (id: number) => void;
  onTogglePin: (id: number, isPinned: boolean) => void;
  /** Raised when a checklist item is ticked or un-ticked. */
  onToggleItem: (itemId: number, isDone: boolean) => void;
  /** Opens the colour picker for this clip. */
  onRecolour: (id: number) => void;
}

export function ClipsCard({
  clip,
  onOpen,
  onEdit,
  onDelete,
  onTogglePin,
  onToggleItem,
  onRecolour,
}: ClipsCardProps) {
  // Ticking is optimistic: the action deliberately does not revalidate the route
  // (a tick on a forty-card board would re-render the lot), so the card has to show
  // the change itself or the box would spring back under the reader's finger.
  const [ticked, setTicked] = useState<Map<number, boolean>>(new Map());
  const [showDone, setShowDone] = useState(false);

  const items = clip.items.map((item) => ({
    ...item,
    isDone: ticked.get(item.id) ?? item.isDone,
  }));
  const { open, done } = buildClipItemBoard(items);

  function handleToggleItem(itemId: number, isDone: boolean) {
    setTicked((previous) => new Map(previous).set(itemId, isDone));
    onToggleItem(itemId, isDone);
  }

  return (
    // `card-embossed` rather than `card-raised`: the card reads as a thick slab —
    // lit top edge, shaded underside, a two-stop cast beneath it. That is
    // `design.md`'s sanctioned way to give a card real depth *without* borrowing
    // the hard offset shadow, which stays the buttons' vocabulary — and this card
    // now has four of them on it, so the two must not read as the same material.
    //
    // It composes over a tint: `.clip-tint` sets only `background-color` and
    // `border-color`, so a coloured card keeps its hue and gains the bevel. The
    // emboss itself is theme-derived (`--edge-lit` mixes toward `--ink`), so the
    // slab reads on the dark themes and the light ones alike.
    <article
      className={`card-embossed rounded-xl border border-line bg-paper-raised p-4 ${
        TINT_CLASS[clip.color] ?? ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        {/* The title opens the clip. A button rather than the whole card being
            clickable: the card holds checkboxes and its own action row, and a
            click target wrapping those swallows them. */}
        <button
          type="button"
          onClick={() => onOpen(clip.id)}
          className="min-w-0 flex-1 text-left font-display text-base text-ink hover:text-brass"
        >
          {clip.title || "(untitled)"}
        </button>

        <div className="flex shrink-0 items-center gap-1">
          {/* A bare glyph, not a slot: a STATE mark ("this clip is sealed"), which
              coding-guide.md keeps off the slot registry. Only icons that mark a
              *place* get a slot. */}
          {clip.isEncrypted && <TreeIcon name="lock" className="h-4 w-4 text-muted" />}
          <JournalPinButton
            isPinned={clip.isPinned}
            onToggle={() => onTogglePin(clip.id, !clip.isPinned)}
          />
        </div>
      </div>

      {clip.excerpt && (
        // `whitespace-pre-wrap` so a clip written as lines stays lines. `break-words`
        // because a pasted URL is otherwise wide enough to stretch its column and
        // unbalance the whole board.
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted">
          {clip.excerpt}
        </p>
      )}

      {open.length > 0 && (
        <ul className="mt-2 space-y-1">
          {open.map((item) => (
            <li key={item.id} className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={false}
                onChange={() => handleToggleItem(item.id, true)}
                aria-label={`Mark "${item.text}" as done`}
                // `mt-0.5` so the box aligns with the first line of a wrapped item.
                className="mt-0.5 h-4 w-4 shrink-0 accent-brass focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
              />
              <span className="min-w-0 flex-1 break-words text-sm text-ink">{item.text}</span>
            </li>
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowDone((value) => !value)}
            aria-expanded={showDone}
            className="flex items-center gap-1 text-xs text-muted hover:text-ink"
          >
            {/* A rotating caret rather than two glyphs: there is no chevron concept
                in the icon set, and a CSS rotation cannot drift out of sync with the
                state the way a pair of names can. */}
            <span
              aria-hidden
              className={`inline-block transition-transform ${showDone ? "rotate-90" : ""}`}
            >
              ›
            </span>
            {done.length} completed item{done.length === 1 ? "" : "s"}
          </button>

          {showDone && (
            <ul className="mt-1 space-y-1">
              {done.map((item) => (
                <li key={item.id} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked
                    onChange={() => handleToggleItem(item.id, false)}
                    aria-label={`Mark "${item.text}" as not done`}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-brass focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
                  />
                  <span className="min-w-0 flex-1 break-words text-sm text-muted line-through">
                    {item.text}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {(clip.categories.length > 0 || clip.tags.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1 text-xs text-muted">
          {[...clip.categories, ...clip.tags].map((name) => (
            <span key={name} className="rounded border border-line px-1.5 py-0.5">
              {name}
            </span>
          ))}
        </div>
      )}

      {(clip.imageCount > 0 || clip.linkCount > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
          {clip.imageCount > 0 && (
            <span>
              {clip.imageCount} image{clip.imageCount === 1 ? "" : "s"}
            </span>
          )}
          {clip.linkCount > 0 && (
            <span>
              attached to {clip.linkCount} entr{clip.linkCount === 1 ? "y" : "ies"}
            </span>
          )}
        </div>
      )}

      {/* Row actions as `Button`s — the app's hard-offset switch treatment, which
          lifts on hover and collapses on press (`design.md` → *The signature:
          buttons are switches*).

          These were small text buttons, on the reasoning that four per card across
          a forty-card board would be the loudest thing on the screen. Min asked for
          the 3D row instead, so density loses to affordance here: each of these is
          a discrete standalone action, which is exactly what `Button` is for.
          `size="sm"` is the most compact the pill form gets.

          `Button`, never a hand-rolled shadow: the offset, the hover lift and the
          press collapse are all theme-token-driven, so the row recolours with the
          running theme instead of being right in one and wrong in the other seven. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => onOpen(clip.id)}>
          Open
        </Button>
        {onEdit && (
          <Button size="sm" variant="secondary" onClick={() => onEdit(clip.id)}>
            Edit
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={() => onRecolour(clip.id)}>
          Colour
        </Button>
        {/* `danger` rather than a red-tinted secondary: deleting is the one
            destructive action on the card, and the variant already carries the
            fixed semantic red the rest of the app uses for it. */}
        <Button size="sm" variant="danger" onClick={() => onDelete(clip.id)}>
          Delete
        </Button>
      </div>
    </article>
  );
}
