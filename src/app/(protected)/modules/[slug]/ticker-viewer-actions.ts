"use server";

// Adapters for the ticker viewer: validate at the boundary, call the use-case,
// hand back a plain result. One action per panel rather than one fat call —
// only "Our data" is cheap enough to run when the viewer opens; each market
// panel is a provider round-trip the reader pays for by opening that tab.

import { listTransactions } from "@/lib/stock-positions";
import {
  getTickerNewsFeed,
  getTickerOwnData,
  getTickerPriceSeries,
  getTickerQuote,
  getTickerRisk,
  getTickerTradeTimeline,
  type TickerHistoryRange,
  type TickerNewsFeed,
  type TickerOwnData,
  type TickerPriceSeries,
  type TickerQuote,
  type TickerRisk,
  type TickerTradeTimeline,
} from "@/lib/ticker-overview";
import { deps } from "@/lib/wiring";

/** Every panel resolves to the same shape, so the viewer handles them uniformly. */
export interface PanelResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

function failed(error: unknown, fallback: string): PanelResult<never> {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

export async function fetchTickerOwnDataAction(
  ticker: string,
): Promise<PanelResult<TickerOwnData>> {
  try {
    return {
      ok: true,
      data: getTickerOwnData(
        { ticker },
        {
          positions: deps.stockPositionRepo,
          accounts: deps.investmentAccountRepo,
          watchLists: deps.stockWatchListRepo,
        },
      ),
    };
  } catch (error) {
    return failed(error, "Could not read this ticker's records.");
  }
}

export async function fetchTickerQuoteAction(ticker: string): Promise<PanelResult<TickerQuote>> {
  try {
    return { ok: true, data: await getTickerQuote(deps.marketDataClient, { ticker }) };
  } catch (error) {
    return failed(error, "Could not reach the market-data provider.");
  }
}

export async function fetchTickerPriceSeriesAction(
  ticker: string,
  range: TickerHistoryRange,
): Promise<PanelResult<TickerPriceSeries>> {
  try {
    return { ok: true, data: await getTickerPriceSeries(deps.marketDataClient, { ticker, range }) };
  } catch (error) {
    return failed(error, "Could not load the price history.");
  }
}

export async function fetchTickerRiskAction(ticker: string): Promise<PanelResult<TickerRisk>> {
  try {
    return { ok: true, data: await getTickerRisk(deps.marketDataClient, { ticker }) };
  } catch (error) {
    return failed(error, "Could not compute the risk figures.");
  }
}

export async function fetchTickerNewsFeedAction(
  ticker: string,
): Promise<PanelResult<TickerNewsFeed>> {
  try {
    return { ok: true, data: await getTickerNewsFeed(deps.tickerNewsClient, { ticker }) };
  } catch (error) {
    return failed(error, "Could not reach the news provider.");
  }
}

/**
 * The "My past performance" chart: our trades plus the provider's closes around
 * them. The database read happens here rather than inside the use-case, which
 * is what keeps that use-case a pure "given these trades, add the market side".
 */
export async function fetchTickerTradeTimelineAction(
  ticker: string,
): Promise<PanelResult<TickerTradeTimeline>> {
  try {
    const transactions = listTransactions(deps.stockPositionRepo, ticker);
    return {
      ok: true,
      data: await getTickerTradeTimeline(
        {
          marketData: deps.marketDataClient,
          news: deps.tickerNewsClient,
          // Same Yahoo client — it implements the events port too, so this
          // costs a wiring line rather than another dependency.
          events: deps.marketDataClient,
        },
        transactions,
        { ticker },
      ),
    };
  } catch (error) {
    return failed(error, "Could not build the performance chart.");
  }
}
