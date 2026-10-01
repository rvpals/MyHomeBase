// Remembering which cards a reader left open.
//
// Pure functions over data: building a storage key, reading and writing a
// route's map of card states, and deciding what a card should do on load. No
// `window` and no React here — the component owns the effect that touches
// localStorage, this owns the rules. That split is what makes the interesting
// part (stored `false` must beat `defaultOpen: true`) testable without a DOM.

/**
 * The localStorage key holding one route's card states.
 *
 * Namespaced `myhomebase:` like every other stored key here (see
 * `layout.tsx`'s section-panel key), then `cards:`, then the route. One entry
 * per route rather than one per card, because a page reads all of its cards at
 * once on mount — a single parse beats one `getItem` per card, and it keeps
 * the key count proportional to routes visited rather than cards rendered.
 */
export function cardStateStorageKey(pathname: string): string {
  return `myhomebase:cards:${pathname}`;
}

/**
 * One route's stored card states, indexed by the card's ordinal on the page.
 *
 * A map keyed by number-as-string rather than an array: a page whose third
 * card is the only one ever toggled stores one entry, not two holes and a
 * value. It also means a page that gains a card doesn't invalidate the file —
 * unknown indexes are simply absent.
 */
export type StoredCardStates = Record<string, boolean>;

/**
 * Parses what came out of localStorage, tolerating anything.
 *
 * Returns an empty map rather than throwing on junk, for the reason
 * `readStoredView` gives in `data-grid.tsx`: a corrupt entry means "nothing
 * saved", not a broken page. The value is user-editable — it is in their own
 * browser — so it is parsed defensively rather than cast.
 *
 * Non-boolean values are dropped individually, so one bad entry doesn't
 * discard the rest of the route's state.
 */
export function parseCardStates(raw: string | null): StoredCardStates {
  if (!raw) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};

  const result: StoredCardStates = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "boolean") result[key] = value;
  }
  return result;
}

/** The stored map with one card's state written in. Pure — returns a new map. */
export function withCardState(
  states: StoredCardStates,
  ordinal: number,
  open: boolean,
): StoredCardStates {
  return { ...states, [String(ordinal)]: open };
}

/**
 * What a card should do on load: what the reader last chose, else its default.
 *
 * The whole point of the module, and the one place a truthiness bug would hide.
 * A stored `false` is a deliberate collapse and **must** win over
 * `defaultOpen: true` — so this tests for presence of the key, never for the
 * value being falsy. `states[ordinal] || defaultOpen` would silently reopen
 * every card the reader had closed, which is the exact opposite of the feature.
 */
export function resolveCardOpen(
  states: StoredCardStates,
  ordinal: number,
  defaultOpen: boolean,
): boolean {
  const stored = states[String(ordinal)];
  return typeof stored === "boolean" ? stored : defaultOpen;
}
