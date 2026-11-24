"use client";

// A behaviour-identical clone of `CollapsibleCard`, kept separate **so its look
// can be redesigned without touching the 128 call sites that render the
// original**. Everything here started as a byte-for-byte copy; the open/closed
// logic, the persistence and the header slots are deliberately the same, and
// the divergence is meant to be visual.
//
// WHY A CLONE AND NOT A `variant` PROP. A variant on `CollapsibleCard` would
// put experimental styling one typo away from every dashboard, settings block
// and module section in the app. A separate component can be pointed at one
// screen, looked at, and thrown away.
//
// IT SHARES `CollapsibleCardScope`'s ORDINAL COUNTER, on purpose. Swapping a
// `CollapsibleCard` for one of these mid-page then leaves every *other* card's
// remembered state where it was — a private counter would renumber the page.
// The flip side, stated plainly: a card that replaces another at the same
// position inherits its remembered open/closed state, because position is the
// key. While experimenting that is what you want.

import { useMemo, useState, type ReactNode } from "react";
import { useCardScope } from "@/components/collapsible-card-scope";
import { useStoredValue, writeStoredValue } from "@/components/use-stored-value";
import {
  cardStateStorageKey,
  parseCardStates,
  resolveCardOpen,
  withCardState,
} from "@/lib/collapsible-state";

export interface CustomizableCardProps {
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

export function CustomizableCard({
  title,
  titleIcon,
  defaultOpen = false,
  open,
  onOpenChange,
  headerAction,
  titleAction,
  children,
  className = "",
}: CustomizableCardProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isControlled = open !== undefined;

  // Remembering this card's state, when it is uncontrolled and inside a scope.
  //
  // A **controlled** card never persists: its owner supplied `open`, so the
  // owner decides, and writing a second source of truth underneath it would
  // fight whoever is driving it.
  const scope = useCardScope();
  const persists = !isControlled && scope !== undefined;

  // Claimed once per mount, via a lazy `useState` initializer rather than a ref
  // written during render — same reasoning as `collapsible-card.tsx`. Nothing
  // calls the setter, so this still causes no re-render.
  const [ordinal] = useState<number | undefined>(() =>
    persists ? scope.claimOrdinal() : undefined,
  );

  // The stored map for this route, as an external store rather than an effect.
  // `useStoredValue` returns `null` on the server and on the first client
  // render, so hydration still matches and the card paints `defaultOpen` for
  // one frame before settling — without the cascading render the effect caused.
  const storageKey = persists ? cardStateStorageKey(scope.pathname) : "";
  const storedRaw = useStoredValue(storageKey);
  const storedStates = useMemo(() => parseCardStates(storedRaw), [storedRaw]);

  // Resolved against the route and this card's slot. `defaultOpen` is only the
  // fallback for a slot the store has never heard of — a parent recomputing it
  // mid-life must not yank the card back from where the reader put it.
  const storedOpen =
    persists && ordinal !== undefined
      ? resolveCardOpen(storedStates, ordinal, defaultOpen)
      : undefined;

  // Three sources, in precedence order: the owner of a controlled card, then
  // what this reader stored for this slot, then this card's own local state.
  const isOpen = isControlled ? open : (storedOpen ?? uncontrolledOpen);

  function toggle() {
    const next = !isOpen;
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);

    if (persists && ordinal !== undefined) {
      // Read-modify-write rather than holding the route's map in state: other
      // cards on this page own their own entries, and re-reading means two
      // cards toggled in quick succession can't clobber each other with a
      // stale copy. A write is a handful of bytes, so the extra parse is free.
      // Re-read before writing: other cards on this page own their own entries,
      // so two toggled in quick succession must not clobber each other with a
      // stale copy. `writeStoredValue` swallows a storage failure and notifies
      // this tab.
      let stored = storedStates;
      try {
        stored = parseCardStates(window.localStorage.getItem(storageKey));
      } catch {
        // Blocked store — the snapshot is as good as it gets.
      }
      writeStoredValue(storageKey, JSON.stringify(withCardState(stored, ordinal, next)));
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
    //
    // `card-framed` is the opt-in to an admin-selected picture frame
    // (migrations/0133). It is applied unconditionally and does nothing on its
    // own: every rule for it in globals.css is scoped to a `[data-card-frame]`
    // ancestor, which the protected layout emits only when a frame is actually
    // selected. So with no frame this card renders exactly as
    // `CollapsibleCard` does, and the component needs no prop, no context and
    // no client state to follow an application-wide setting.
    <div
      className={`card-raised card-raised-hover card-framed rounded-xl border border-line bg-paper-raised transition-shadow motion-reduce:transition-none ${className}`}
    >
      {/* A row rather than one big button, so `headerAction` can hold a real button. */}
      <div className="flex items-center gap-2 px-4 py-3 max-lg:items-start">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={isOpen}
          // Without a `titleAction` this stays exactly as it was: `flex-1` and
          // `justify-between`, so the chevron it contains is pushed to the far right of
          // the header, matching the original's layout exactly.
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
