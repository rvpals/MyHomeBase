"use client";

// The dashboard heading's favorites menu: a star that drops down the symbols you
// starred, each opening the ticker viewer.
//
// Route-local for the same reason `StockTickerSearch` is — it calls this module's
// server action and owns a `TickerViewerHost`.
//
// A jump list, not a search: the whole point is that it's short and hand-picked,
// so there's no filtering here and no cap. If it ever grows past a screenful, the
// answer is fewer favorites rather than a scrollbar.
//
// The star is *marked* in the ticker viewer's header, not here — one control in
// the one place every ticker in the app already opens.
//
// Each row also shows its **last-refreshed** price, read from `stk_positions`
// rather than quoted live: opening the menu stays a DB read, and the figures
// agree with the positions table instead of differing by whatever moved between
// two fetches. A favorite that isn't a holding has no stored price and shows a
// dash — starring a watch candidate you don't own is the normal case.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { TickerLogo } from "@/components/ticker-logo";
import { TreeIcon } from "@/components/tree-icons";
import { formatCents } from "@/lib/shared/money";
import type { FavoriteQuote } from "@/lib/ticker-favorites";
import { listFavoriteQuotesAction } from "./ticker-favorites-actions";
import { TickerViewerHost } from "./ticker-viewer-host";

// Same rule as the dashboard's tiles: red is down, green is up. A flat day reads
// as green, which is what the positions table already does.
function gainClass(cents: number): string {
  return cents < 0 ? "text-red-400" : "text-emerald-400";
}

export function StockFavoritesMenu() {
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [favorites, setFavorites] = useState<FavoriteQuote[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [openTicker, setOpenTicker] = useState<string | undefined>(undefined);

  const close = useCallback(() => setIsOpen(false), []);

  // Loaded when the menu opens rather than on mount: the list changes from inside
  // the viewer dialog, so fetching on open is also what keeps it fresh after a
  // star is flipped without needing the dashboard to revalidate.
  useEffect(() => {
    if (!isOpen) return;
    let stale = false;
    setIsLoading(true);
    void listFavoriteQuotesAction()
      .then((rows) => {
        if (!stale) setFavorites(rows);
      })
      .finally(() => {
        if (!stale) setIsLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handlePointerDown(event: MouseEvent | TouchEvent) {
      if (!containerRef.current?.contains(event.target as Node)) close();
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, close]);

  function openViewer(ticker: string) {
    setOpenTicker(ticker);
    close();
  }

  return (
    <>
      {/* Full width on a narrow screen only while open, so the closed star sits
          on the heading line beside the other controls instead of claiming a row. */}
      <div
        ref={containerRef}
        className={`relative ${isOpen ? "max-lg:w-full" : ""}`}
      >
        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          aria-expanded={isOpen}
          aria-controls={listboxId}
          title="Show favorite stocks"
          aria-label="Show favorite stocks"
          className="rounded-md p-1 text-brass hover:text-brass-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        >
          <TreeIcon name={isOpen ? "star-filled" : "star"} className="h-5 w-5" />
        </button>

        {isOpen && (
          // Same shape as the search dropdown: a popover on desktop, a static
          // full-width block on a narrow screen where a popover could overflow.
          <ul
            id={listboxId}
            role="listbox"
            aria-label="Favorite stocks"
            className="absolute left-0 top-full z-20 mt-1 w-72 overflow-hidden rounded-md border border-line bg-paper-raised shadow-lg max-lg:static max-lg:w-full max-lg:shadow-none"
          >
            {isLoading && favorites.length === 0 ? (
              <li className="px-3 py-2 text-xs text-muted">Loading…</li>
            ) : favorites.length === 0 ? (
              <li className="px-3 py-2 text-xs text-muted">
                No favorites yet — open a ticker and press the star in its header.
              </li>
            ) : (
              favorites.map((favorite) => (
                <li key={favorite.ticker} role="none">
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => openViewer(favorite.ticker)}
                    title={
                      favorite.updatedAt
                        ? `Last refreshed ${new Date(favorite.updatedAt).toLocaleString()}`
                        : "Not held — no stored price"
                    }
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink hover:bg-brass-soft hover:text-brass-dark"
                  >
                    {/* Falls back to a monogram on its own for a symbol with no
                        artwork, which is most ETFs — so no conditional here. */}
                    <TickerLogo ticker={favorite.ticker} size={20} />
                    <span className="font-medium">{favorite.ticker}</span>

                    {/* Price right-aligned, so the symbols stay a scannable column
                        and the numbers line up against the menu's edge. */}
                    {favorite.priceCents == null ? (
                      <span className="ml-auto text-xs text-muted" aria-label="Not held">
                        —
                      </span>
                    ) : (
                      <span className="ml-auto flex items-baseline gap-1.5 tabular-nums">
                        <span>{formatCents(favorite.priceCents)}</span>
                        {/* Both halves fit at every width: the popover is w-72 on
                            desktop, and below 1024px the menu is a full-width
                            block, which is roomier still. */}
                        <span className={`text-xs ${gainClass(favorite.dayGainLossCents ?? 0)}`}>
                          {(favorite.dayChangePct ?? 0) >= 0 ? "+" : ""}
                          {(favorite.dayChangePct ?? 0).toFixed(2)}%
                        </span>
                      </span>
                    )}
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      {openTicker && (
        <TickerViewerHost ticker={openTicker} onClose={() => setOpenTicker(undefined)} />
      )}
    </>
  );
}
