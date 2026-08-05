"use client";

// Drives `TickerViewer`: owns the per-panel load state and calls the server
// actions. Route-local rather than a registered component — it's the "page that
// fetched it" half of the pair, and it knows about this module's actions, which
// a shared component must not.
//
// Our own records load as soon as the dialog opens. Each market panel is a
// provider round-trip, so it loads the first time that tab is opened and is then
// kept for as long as the dialog is up.

import { useEffect, useRef, useState } from "react";
import {
  TickerViewer,
  type TickerPanelKey,
  type TickerPanelState,
} from "@/components/ticker-viewer";
import { TickerLogo } from "@/components/ticker-logo";
import type { TickerHistoryRange } from "@/lib/ticker-overview";
import {
  fetchTickerNewsFeedAction,
  fetchTickerOwnDataAction,
  fetchTickerPriceSeriesAction,
  fetchTickerQuoteAction,
  fetchTickerRiskAction,
  fetchTickerTradeTimelineAction,
  type PanelResult,
} from "./ticker-viewer-actions";

export interface TickerViewerHostProps {
  ticker: string;
  onClose: () => void;
}

/**
 * The logo-plus-symbol cell, as a button that opens the viewer.
 *
 * Route-local, not a registered shared component — same call as
 * `AccountIconImage`: it's the identical two-line cell that the positions,
 * transactions and watchlist grids in this folder were each rendering inline,
 * so it's shared between siblings rather than promoted to `src/components/`.
 * It stays a plain text link rather than a `Button` because design.md keeps
 * row-level actions inside a grid unstyled.
 */
export function TickerCell({
  ticker,
  onOpen,
  size = 24,
}: {
  ticker: string;
  onOpen: (ticker: string) => void;
  size?: number;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(ticker)}
      title={`Open the ${ticker} viewer`}
      className="flex items-center gap-2 text-brass-dark hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
    >
      <TickerLogo ticker={ticker} size={size} />
      {ticker}
    </button>
  );
}

/**
 * Loads a panel the first time it is shown, and again whenever `requestKey`
 * changes (which is how the chart reloads on a range switch).
 *
 * A refetch keeps the previous data in state and only raises `isLoading`, so the
 * panel can show an inline spinner over content that's already on screen rather
 * than blanking.
 */
function useLazyPanel<T>(
  isActive: boolean,
  requestKey: string,
  load: () => Promise<PanelResult<T>>,
): TickerPanelState<T> {
  const [state, setState] = useState<TickerPanelState<T>>({});
  const requested = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!isActive || requested.current === requestKey) return;
    requested.current = requestKey;

    let cancelled = false;
    setState((previous) => ({ ...previous, isLoading: true, error: undefined }));

    load()
      .then((result) => {
        if (cancelled) return;
        setState(
          result.ok && result.data
            ? { data: result.data }
            : { error: result.error ?? "Nothing came back." },
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({ error: error instanceof Error ? error.message : "Something went wrong." });
      });

    return () => {
      cancelled = true;
    };
    // `load` is a fresh closure every render; `requestKey` is the request's real
    // identity, so it — not the function — is what should retrigger the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, requestKey]);

  return state;
}

function TickerViewerHostInner({ ticker, onClose }: TickerViewerHostProps) {
  const [activePanel, setActivePanel] = useState<TickerPanelKey>("own:holdings");
  const [range, setRange] = useState<TickerHistoryRange>("1y");

  const ownData = useLazyPanel(true, ticker, () => fetchTickerOwnDataAction(ticker));
  // Lives under "Our data" but is a provider call, so it waits for the tab like
  // the Market panels do rather than being paid for on open.
  const tradeTimeline = useLazyPanel(activePanel === "own:trades", ticker, () =>
    fetchTickerTradeTimelineAction(ticker),
  );
  const quote = useLazyPanel(activePanel === "market:quote", ticker, () =>
    fetchTickerQuoteAction(ticker),
  );
  const priceSeries = useLazyPanel(
    activePanel === "market:chart",
    `${ticker}:${range}`,
    () => fetchTickerPriceSeriesAction(ticker, range),
  );
  const risk = useLazyPanel(activePanel === "market:risk", ticker, () =>
    fetchTickerRiskAction(ticker),
  );
  const news = useLazyPanel(activePanel === "market:news", ticker, () =>
    fetchTickerNewsFeedAction(ticker),
  );

  return (
    <TickerViewer
      ticker={ticker}
      activePanel={activePanel}
      onSelectPanel={setActivePanel}
      onClose={onClose}
      ownData={ownData}
      tradeTimeline={tradeTimeline}
      quote={quote}
      priceSeries={priceSeries}
      risk={risk}
      news={news}
      range={range}
      onSelectRange={setRange}
    />
  );
}

/**
 * Keyed by ticker so opening a different symbol remounts with clean state —
 * cheaper and less error-prone than resetting five panels by hand.
 */
export function TickerViewerHost(props: TickerViewerHostProps) {
  return <TickerViewerHostInner key={props.ticker} {...props} />;
}
