"use client";

// Board or list, remembered per device.
//
// The same rows in two shapes, so neither is "the real one" — which is why this
// is `ViewModeSwitch` and not `Tabs`: tabs put *different content* in one space
// and read as separate places, and this is one dataset being re-cut.
//
// The choice lives in `localStorage`, not in the URL and not in the database.
// It is a per-device preference about how this screen looks, not state anyone
// should bookmark or share — a link to a filtered library should open in
// whichever shape the person following it prefers. `design.md` keeps genuinely
// shareable state in search params; this is the other kind.

import { useSyncExternalStore, type ReactNode } from "react";
import { MasonryBoard } from "@/components/masonry-board";
import { ViewModeSwitch } from "@/components/view-mode-switch";
import { dealIntoColumns } from "@/lib/code-library";

export type CodeLibraryViewMode = "list" | "board";

const VIEW_MODE_KEY = "code-library:view-mode";

const OPTIONS = [
  { key: "list" as const, label: "List", hint: "One snippet per row" },
  { key: "board" as const, label: "Board", hint: "Cards in balanced columns" },
];

export interface CodeLibraryCard {
  id: number;
  /** The card, rendered on the server. */
  node: ReactNode;
  /**
   * Roughly how tall it will render, from `estimateSnippetCardHeight`.
   *
   * Carried alongside the node because the board balances columns by height and
   * a `ReactNode` cannot be measured — by the time the cards reach this
   * component they are opaque, so the estimate has to travel with them.
   */
  weight: number;
}

export interface CodeLibraryBand {
  /** A heading above this group, or `""` for none. */
  label: string;
  /** One pre-rendered card per snippet, keyed. Built on the server. */
  cards: CodeLibraryCard[];
}

/**
 * `localStorage` as an external store, read through `useSyncExternalStore`.
 *
 * The obvious shape — `useState("list")` plus an effect that reads storage after
 * mount — is what `react-hooks/set-state-in-effect` refuses, and rightly: it
 * renders once with the wrong value and again with the right one. This is the
 * API React provides for exactly this problem. `getServerSnapshot` is what makes
 * it safe during SSR, where there is no `window` at all.
 *
 * Listeners are module-level because a same-tab write fires no `storage` event —
 * that event is for *other* tabs. Subscribing to both means the switch also
 * follows along if this library is open in a second window.
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readMode(): CodeLibraryViewMode {
  try {
    return window.localStorage.getItem(VIEW_MODE_KEY) === "board" ? "board" : "list";
  } catch {
    // Private mode, blocked site data, a browser that throws on access. The
    // preference simply does not persist — never a reason to fail to draw.
    return "list";
  }
}

/** The server has no storage, so everyone starts on the list there. */
function serverMode(): CodeLibraryViewMode {
  return "list";
}

export function CodeLibraryViewMode({ bands }: { bands: CodeLibraryBand[] }) {
  const mode = useSyncExternalStore(subscribe, readMode, serverMode);

  function choose(next: CodeLibraryViewMode) {
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, next);
    } catch {
      // As above — the choice just will not survive a reload.
    }
    // `storage` does not fire in the tab that wrote, so this tab is told
    // directly. Without it the switch would not move until something else
    // re-rendered.
    for (const listener of listeners) listener();
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <ViewModeSwitch
          options={OPTIONS}
          value={mode}
          onChange={choose}
          label="View"
          // Two short labels, so the segmented row fits a 390px screen with room
          // to spare and a full-width dropdown above every list would be far
          // heavier than the choice deserves.
          compact="segments"
        />
      </div>

      {/* The switch sits above *all* the bands rather than one per band: it is
          one choice about this screen, and two switches on one page would let
          the pinned band and the rest disagree about their own shape. */}
      {bands.map((band) => (
        <div key={band.label} className="space-y-3">
          {band.label !== "" && (
            <h2 className="text-xs uppercase tracking-wide text-muted">{band.label}</h2>
          )}

          {mode === "board" ? (
            // One column on a phone, three on a desktop — the board's own
            // defaults, stated rather than inherited so a change there is a
            // visible change here.
            <MasonryBoard
              items={band.cards}
              itemKey={(card) => card.id}
              renderItem={(card) => card.node}
              // Shortest column first, by the estimate each card carries.
              // Round-robin would keep reading order and ignore height, which
              // is the ragged bottom a board exists to avoid.
              deal={(cards, count) => dealIntoColumns(cards, count, (card) => card.weight)}
              columns={{ compact: 1, wide: 3 }}
            />
          ) : (
            <ul className="space-y-3">
              {band.cards.map((card) => (
                <li key={card.id}>{card.node}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
