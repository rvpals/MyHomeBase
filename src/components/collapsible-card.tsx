"use client";

import { useState, type ReactNode } from "react";

export interface CollapsibleCardProps {
  /** Header text, always visible. */
  title: string;
  /**
   * Small decorative glyph rendered immediately before `title`, inside the
   * toggle. Purely visual — the title text is what names the card, so pass an
   * `aria-hidden` icon and don't put meaning here that the title doesn't
   * already carry. A slot rather than a widened `title` so the header keeps its
   * text-only truncation behaviour.
   */
  titleIcon?: ReactNode;
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
  /**
   * Rendered **immediately after the title text**, with the header's flexible space
   * after it — so it sits beside the title rather than out at the right-hand edge
   * where `headerAction` lives.
   *
   * The distinction is about what the control refers to. `headerAction` is for the
   * card's own affordances (refresh this card, explain this card) and reads correctly
   * grouped with the chevron. This slot is for an action that belongs *to the title* —
   * the home screen's "launch the module these numbers came from" — which has to be
   * adjacent to the name it acts on, or it reads as another card control.
   *
   * Outside the toggle for the same reason as `headerAction`: a button can't nest in
   * a button, so clicking this never expands or collapses the card.
   */
  titleAction?: ReactNode;
  /** Body content, shown when expanded. */
  children: ReactNode;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

export function CollapsibleCard({
  title,
  titleIcon,
  defaultOpen = false,
  open,
  onOpenChange,
  headerAction,
  titleAction,
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

  // Shared by both placements below — in the toggle normally, in its own little button
  // once `titleAction` has taken the spot beside the title. One definition so the two
  // can't drift in size, colour or rotation.
  const chevron = (
    <span
      className={`shrink-0 text-muted transition-transform motion-reduce:transition-none ${
        isOpen ? "rotate-90" : ""
      }`}
      aria-hidden
    >
      &rsaquo;
    </span>
  );

  return (
    // `card-raised` (globals.css) supplies the lift: an inset top highlight, a
    // hairline ring that deepens `border-line`, and a soft cast shadow. The
    // caller's `className` still comes last, so a card can opt out.
    <div
      className={`card-raised card-raised-hover rounded-xl border border-line bg-paper-raised transition-shadow motion-reduce:transition-none ${className}`}
    >
      {/* A row rather than one big button, so `headerAction` can hold a real button. */}
      <div className="flex items-center gap-2 px-4 py-3 max-lg:items-start">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={isOpen}
          // Without a `titleAction` this stays exactly as it was: `flex-1` and
          // `justify-between`, so the chevron it contains is pushed to the far right of
          // the header and every existing card renders unchanged.
          //
          // With one, the toggle shrinks to its content instead and the chevron is
          // rendered by the row below rather than in here — a `flex-1` toggle would put
          // its own trailing chevron between the title and the action, which is the one
          // place the action must not be.
          className={`flex min-w-0 items-center gap-2 text-left text-sm font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass max-lg:items-start ${
            titleAction ? "" : "flex-1 justify-between"
          }`}
        >
          {/* The icon and the title share a min-w-0 flex row so the title still
              truncates, while the glyph keeps its size rather than being
              squeezed by a long one. Narrow, there's no room to truncate into —
              a title like "Random photo - 21 years, 2 months, 3 days ago" would
              be all ellipsis — so on phones it wraps instead and the row tops
              out its items so the glyph stays beside the first line. */}
          <span className="flex min-w-0 items-center gap-2 max-lg:items-start">
            {titleIcon && <span className="shrink-0 text-brass-dark">{titleIcon}</span>}
            <span className="truncate max-lg:whitespace-normal max-lg:break-words max-lg:[overflow-wrap:anywhere] max-lg:overflow-visible">
              {title}
            </span>
          </span>
          {/* Inside the toggle in the no-`titleAction` case, where `justify-between`
              pushes it to the header's right edge — unchanged from before. */}
          {!titleAction && chevron}
        </button>
        {/* Beside the title, ahead of the spacer: this is an action *on the title*, so
            it has to be adjacent to the name it acts on. */}
        {titleAction && <div className="shrink-0">{titleAction}</div>}
        {/* The flexible space the caller asked for, pushing the chevron and any
            `headerAction` out to the right edge. Only needed when the toggle has given
            up its own `flex-1` above. */}
        {titleAction && (
          <>
            <div className="min-w-0 flex-1" />
            {/* Not in the toggle any more, so it needs its own click target — readers
                have always been able to collapse these cards by the chevron, and moving
                it out of the button silently took that away. `tabIndex={-1}` and
                `aria-hidden` keep it out of the tab order and off the a11y tree: the
                toggle beside it is the real, labelled control. */}
            <button
              type="button"
              onClick={toggle}
              tabIndex={-1}
              aria-hidden
              className="shrink-0 focus-visible:outline-none"
            >
              {chevron}
            </button>
          </>
        )}
        {headerAction && <div className="shrink-0">{headerAction}</div>}
      </div>
      {isOpen && <div className="border-t border-line px-4 py-4">{children}</div>}
    </div>
  );
}
