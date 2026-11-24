"use client";

// Hands each `CollapsibleCard` on a page a stable number, so its open/closed
// state can be remembered without any call site passing an id.
//
// WHY A COUNTER AND NOT THE TITLE. The obvious key is the card's title, and it
// doesn't work: a third of the cards here compute their title from live data
// (`Edit: ${entry.name}`, `Allowed addresses (${allowlist.length})`). Keying on
// that means the key changes when the data does — add an address and the card
// forgets it was open, because `Allowed addresses (3)` and `(4)` are different
// keys. A card's *position* on its page is the thing that stays still.
//
// THE KNOWN WEAKNESS, STATED PLAINLY. If a page conditionally renders a card
// above others, every ordinal below it shifts, and those cards load with their
// neighbour's state. One click puts it right and nothing is lost. This was
// weighed against an opt-in id prop at all 59 call sites and accepted: the cost
// is a wrong chevron until first click, on a minority of pages.

import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";

interface CardScope {
  /** The route these ordinals belong to — part of the storage key. */
  pathname: string;
  /** Claims the next ordinal. Called once per card, during its first render. */
  claimOrdinal: () => number;
}

/**
 * Absent by default, and that absence is meaningful.
 *
 * A `CollapsibleCard` rendered outside a scope (a test, a card in the unauth'd
 * shell) simply doesn't persist, rather than throwing. Persistence is a
 * convenience; a card with none still works exactly as it always did.
 */
const CardScopeContext = createContext<CardScope | undefined>(undefined);

/**
 * Wraps a routed subtree so the cards inside it can remember their state.
 *
 * Mounted once in the protected layout rather than per page — every card under
 * it is covered, which is what "all of the cards, automatically" requires.
 */
export function CollapsibleCardScope({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // A ref, not state: claiming an ordinal must not schedule a render, or every
  // card mounting would re-render the whole subtree. Keyed by pathname so the
  // count restarts on navigation — `useRef` survives a route change, and
  // without this reset the second page's first card would be ordinal 7.
  const counter = useRef({ pathname: "", next: 0 });

  // The reset moved **inside** the callback. It used to run during render,
  // which `react-hooks/refs` forbids — the compiler cannot reason about when a
  // render-phase ref write happened, and under concurrent rendering it might
  // happen more than once or be thrown away.
  //
  // Doing it here instead is both legal and more honest about the invariant:
  // the counter restarts for a new route the moment that route's *first card*
  // asks for a number, which is exactly when it matters. A route whose cards
  // never claim never needs a reset.
  const claimOrdinal = useCallback((forPathname: string) => {
    if (counter.current.pathname !== forPathname) {
      counter.current = { pathname: forPathname, next: 0 };
    }
    const ordinal = counter.current.next;
    counter.current.next += 1;
    return ordinal;
  }, []);

  // The pathname is bound here rather than exposed in the context's signature,
  // so a card still calls `claimOrdinal()` with no arguments and cannot pass
  // the wrong route by mistake.
  const value = useMemo(
    () => ({ pathname, claimOrdinal: () => claimOrdinal(pathname) }),
    [pathname, claimOrdinal],
  );

  return <CardScopeContext.Provider value={value}>{children}</CardScopeContext.Provider>;
}

/** The scope a card is in, or `undefined` when it isn't in one. */
export function useCardScope(): CardScope | undefined {
  return useContext(CardScopeContext);
}
