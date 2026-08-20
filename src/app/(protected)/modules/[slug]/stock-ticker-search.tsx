"use client";

// The dashboard heading's ticker search: a magnifier that opens a small field,
// suggests symbols the system already knows, and opens the ticker viewer on the
// one you pick.
//
// Route-local rather than a registered component, for the same reason
// `TickerCell` is: it calls this module's server action and it owns a
// `TickerViewerHost`, neither of which belongs in `src/components/`.
//
// Free text is allowed — a symbol we've never seen is still a legitimate thing
// to look up. What changes is which tab opens: a known symbol has holdings and
// trades to show, so it lands on "Our data"; an unknown one would show three
// empty cards there, so it lands on the provider tab instead.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { TickerLogo } from "@/components/ticker-logo";
import { TreeIcon } from "@/components/tree-icons";
import type { TickerPanelGroup } from "@/components/ticker-viewer";
import { normalizeQuery, type TickerSuggestion } from "@/lib/ticker-search";
import { searchTickersAction } from "./stock-search-actions";
import { TickerViewerHost } from "./ticker-viewer-host";

/** What a suggestion's source is called in the list. */
const SOURCE_LABELS: Record<TickerSuggestion["source"], string> = {
  position: "held",
  watchlist: "watching",
  profile: "known",
};

interface OpenRequest {
  ticker: string;
  group: TickerPanelGroup;
}

export function StockTickerSearch() {
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<TickerSuggestion[]>([]);
  const [isExactKnown, setIsExactKnown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [request, setRequest] = useState<OpenRequest | undefined>(undefined);

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery("");
    setSuggestions([]);
    setIsExactKnown(false);
    setHighlightedIndex(0);
  }, []);

  // Fetching on every keystroke, with the last response winning. The action is a
  // local SQLite read, so debouncing would add latency to hide a cost that isn't
  // there; `stale` is what keeps an out-of-order reply from overwriting a newer
  // one.
  useEffect(() => {
    if (!isOpen) return;
    let stale = false;
    void searchTickersAction(query).then((result) => {
      if (stale) return;
      setSuggestions(result.suggestions);
      setIsExactKnown(result.isExactKnown);
      setHighlightedIndex(0);
    });
    return () => {
      stale = true;
    };
  }, [isOpen, query]);

  // Clicking elsewhere closes the field. Registered only while open, so the
  // dashboard doesn't carry a listener for a control nobody is using.
  useEffect(() => {
    if (!isOpen) return;
    function handlePointerDown(event: MouseEvent | TouchEvent) {
      if (!containerRef.current?.contains(event.target as Node)) close();
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [isOpen, close]);

  function openField() {
    setIsOpen(true);
    // The input mounts with the field, so focus has to wait a frame for the ref.
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  /** A symbol from the list: known by definition, so open on our own data. */
  function openSuggestion(suggestion: TickerSuggestion) {
    setRequest({ ticker: suggestion.ticker, group: "own" });
    close();
  }

  /** Whatever is typed, when there's nothing highlighted to take instead. */
  function openTypedQuery() {
    const ticker = normalizeQuery(query);
    if (ticker === "") return;
    setRequest({ ticker, group: isExactKnown ? "own" : "yahoo" });
    close();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((index) => Math.min(index + 1, suggestions.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      // Not inside a form today, but preventDefault anyway so a future wrapping
      // form can't be submitted by picking a suggestion.
      event.preventDefault();
      const highlighted = suggestions[highlightedIndex];
      if (highlighted) openSuggestion(highlighted);
      else openTypedQuery();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }

  return (
    <>
      {/* `relative` anchors the desktop dropdown; on a narrow screen the wrapper
          takes the whole line (the heading row is `flex-wrap`) and the list
          becomes a block below the field rather than a popover that could
          overflow the viewport. */}
      <div ref={containerRef} className="relative max-lg:w-full">
        {!isOpen ? (
          <button
            type="button"
            onClick={openField}
            title="Search for ticker"
            aria-label="Search for ticker"
            className="rounded-md p-1 text-brass hover:text-brass-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          >
            <TreeIcon name="search" className="h-5 w-5" />
          </button>
        ) : (
          <div className="flex items-center gap-2 max-lg:w-full">
            <TreeIcon name="search" className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded={suggestions.length > 0}
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-label="Search for ticker"
              placeholder="Search for ticker"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              className="w-44 rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass max-lg:w-full"
            />
          </div>
        )}

        {isOpen && (
          <ul
            id={listboxId}
            role="listbox"
            className="absolute left-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-md border border-line bg-paper-raised shadow-lg max-lg:static max-lg:w-full max-lg:shadow-none"
          >
            {suggestions.length === 0 ? (
              <li className="px-3 py-2 text-xs text-muted">
                {normalizeQuery(query) === ""
                  ? "No tickers on the system yet."
                  : "Not on the system — press Enter to look it up."}
              </li>
            ) : (
              suggestions.map((suggestion, index) => (
                <li key={suggestion.ticker} role="none">
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === highlightedIndex}
                    onClick={() => openSuggestion(suggestion)}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm text-ink ${
                      index === highlightedIndex ? "bg-brass-soft text-brass-dark" : ""
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {/* Same logo-then-symbol order as `TickerCell` and the
                          favorites menu, so a ticker reads the same everywhere.
                          `TickerLogo` falls back to a monogram by itself. */}
                      <TickerLogo ticker={suggestion.ticker} size={20} />
                      <span className="truncate font-medium">{suggestion.ticker}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted">
                      {SOURCE_LABELS[suggestion.source]}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      {request && (
        <TickerViewerHost
          ticker={request.ticker}
          initialGroup={request.group}
          onClose={() => setRequest(undefined)}
        />
      )}
    </>
  );
}
