"use client";

// Drives `TickerViewer`: owns the per-panel load state and calls the server
// actions. Route-local rather than a registered component — it's the "page that
// fetched it" half of the pair, and it knows about this module's actions, which
// a shared component must not.
//
// Loading is per *tab*, not per card: entering a tab loads everything on it, so
// a reader scrolling its cards never meets one that hasn't started. Each result
// is then kept for as long as the dialog is up. Risk is the cheap one despite
// being the heaviest to compute — it comes from `stk_ticker_risk_cache` and only
// hits the provider on a first-ever calculation or an explicit Recalculate.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  TickerViewer,
  type TickerPanelGroup,
  type TickerPanelState,
} from "@/components/ticker-viewer";
import { TickerLogo } from "@/components/ticker-logo";
import type { TickerHistoryRange } from "@/lib/ticker-overview";
import {
  fetchTickerDetailAction,
  fetchTickerEventsAction,
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
  const [activeGroup, setActiveGroup] = useState<TickerPanelGroup>("own");
  const [range, setRange] = useState<TickerHistoryRange>("1y");
  // Bumped by Recalculate. It's part of the risk panel's request key, so the
  // hook treats each press as a new request and refetches — while keeping the
  // figures already on screen until the new ones land.
  const [riskRecalculations, setRiskRecalculations] = useState(0);

  const onOwnTab = activeGroup === "own";
  const onMarketTab = activeGroup === "market";

  const ownData = useLazyPanel(true, ticker, () => fetchTickerOwnDataAction(ticker));
  // A provider call that lives on the "Our data" tab. It loads with the rest of
  // that tab — i.e. on open — but nothing waits for it: the trade table renders
  // from `ownData` immediately and the chart below fills in when this arrives.
  const tradeTimeline = useLazyPanel(onOwnTab, ticker, () =>
    fetchTickerTradeTimelineAction(ticker),
  );
  const quote = useLazyPanel(onMarketTab, ticker, () => fetchTickerQuoteAction(ticker));
  const priceSeries = useLazyPanel(onMarketTab, `${ticker}:${range}`, () =>
    fetchTickerPriceSeriesAction(ticker, range),
  );
  const events = useLazyPanel(onMarketTab, ticker, () => fetchTickerEventsAction(ticker));
  const risk = useLazyPanel(onMarketTab, `${ticker}:${riskRecalculations}`, () =>
    // Only a press of Recalculate asks the provider for new figures; the first
    // load reads whatever is stored, at any age.
    fetchTickerRiskAction(ticker, riskRecalculations > 0),
  );
  const news = useLazyPanel(onMarketTab, ticker, () => fetchTickerNewsFeedAction(ticker));
  // One call feeds all six cards on the Yahoo tab, so there's nothing to stagger.
  const detail = useLazyPanel(activeGroup === "yahoo", ticker, () =>
    fetchTickerDetailAction(ticker),
  );

  const recalculateRisk = useCallback(() => setRiskRecalculations((count) => count + 1), []);

  return (
    <TickerViewer
      ticker={ticker}
      activeGroup={activeGroup}
      onSelectGroup={setActiveGroup}
      onClose={onClose}
      ownData={ownData}
      tradeTimeline={tradeTimeline}
      quote={quote}
      priceSeries={priceSeries}
      events={events}
      risk={risk}
      news={news}
      detail={detail}
      range={range}
      onSelectRange={setRange}
      onRecalculateRisk={recalculateRisk}
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
