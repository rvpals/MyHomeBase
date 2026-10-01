"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useCardScope } from "@/components/collapsible-card-scope";
import {
  cardStateStorageKey,
  parseCardStates,
  resolveCardOpen,
  withCardState,
} from "@/lib/collapsible-state";

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
  /**
   * Whether the body starts expanded. Ignored when `open` is supplied.
   *
   * Only the *first* visit: an uncontrolled card remembers what the reader last
   * did with it (in localStorage, per route — see `CollapsibleCardScope`), and
   * that memory wins over this once it exists. A card the reader collapsed
   * stays collapsed on their next visit even with `defaultOpen` set, which is
   * the point. Controlled cards never persist.
   */
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

  // Remembering this card's state, when it is uncontrolled and inside a scope.
  //
  // A **controlled** card never persists: its owner supplied `open`, so the
  // owner decides, and writing a second source of truth underneath it would
  // fight whoever is driving it.
  const scope = useCardScope();
  const persists = !isControlled && scope !== undefined;

  // Claimed once, on first render, and held for this card's whole life. A ref
  // rather than state because assigning it must not cause a render, and
  // re-claiming on every render would hand the same card a new number each time.
  const ordinalRef = useRef<number | undefined>(undefined);
  if (persists && ordinalRef.current === undefined) {
    ordinalRef.current = scope.claimOrdinal();
  }
  const ordinal = ordinalRef.current;

  // Read on mount, not in the `useState` initializer. localStorage doesn't
  // exist during SSR, so reading it during render would make the server and the
  // first client render disagree and blow up hydration — the reason `data-grid`
  // and `chart-toolbar` both read in an effect too.
  //
  // The cost is one frame: a card with `defaultOpen` that the reader has since
  // collapsed paints open, then closes. Accepted over a blocking inline script
  // in the document head, which would have to duplicate the key scheme.
  useEffect(() => {
    if (!persists || ordinal === undefined) return;
    const stored = parseCardStates(window.localStorage.getItem(cardStateStorageKey(scope.pathname)));
    setUncontrolledOpen(resolveCardOpen(stored, ordinal, defaultOpen));
    // Deliberately keyed on the route and this card's slot, not on `defaultOpen`:
    // a parent that recomputes `defaultOpen` mid-life must not yank the card back
    // from where the reader put it. Re-reads on navigation, which is when the
    // stored map it should be reading actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persists, ordinal, scope?.pathname]);

  function toggle() {
    const next = !isOpen;
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);

    if (persists && ordinal !== undefined) {
      // Read-modify-write rather than holding the route's map in state: other
      // cards on this page own their own entries, and re-reading means two
      // cards toggled in quick succession can't clobber each other with a
      // stale copy. A write is a handful of bytes, so the extra parse is free.
      const key = cardStateStorageKey(scope.pathname);
      try {
        const stored = parseCardStates(window.localStorage.getItem(key));
        window.localStorage.setItem(key, JSON.stringify(withCardState(stored, ordinal, next)));
      } catch {
        // Storage full, or blocked in a private window. The card still opens
        // and closes — only the remembering is lost, which is not worth
        // breaking a click over.
      }
    }
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
