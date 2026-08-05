import type { MarketDataClient, MarketEventsClient } from "./ports";
import type { MarketEvent, PricePoint, Quote } from "./types";

// Yahoo Finance's unofficial, unauthenticated chart/quoteSummary endpoints — no API
// key, but no SLA either. The v10 quoteSummary calls (the dividend-rate fallback and
// the earnings history) need a session cookie + "crumb" token; query1/query2 chart
// endpoints don't. Ported from the source PWA's server/services/yahoo-finance.js.

interface ChartResult {
  meta: {
    regularMarketPrice: number;
    chartPreviousClose?: number;
    previousClose?: number;
    shortName?: string;
    trailingAnnualDividendRate?: number;
  };
  timestamp?: number[];
  indicators?: {
    quote?: [
      {
        high?: (number | null)[];
        low?: (number | null)[];
        close?: (number | null)[];
        volume?: (number | null)[];
      },
    ];
  };
  /** Present only when the request asked for `events=div,split`. */
  events?: {
    dividends?: Record<string, { amount?: number; date?: number }>;
    splits?: Record<
      string,
      { date?: number; splitRatio?: string; numerator?: number; denominator?: number }
    >;
  };
}

interface ChartResponse {
  chart?: { result?: ChartResult[] };
}

/** Only the modules this client asks for are typed; the rest of the payload is ignored. */
interface QuoteSummaryResult {
  summaryDetail?: { trailingAnnualDividendRate?: { raw?: number } };
  earningsHistory?: {
    history?: {
      epsActual?: { raw?: number } | null;
      epsEstimate?: { raw?: number } | null;
      quarter?: { raw?: number } | null;
    }[];
  };
}

interface QuoteSummaryResponse {
  quoteSummary?: { result?: QuoteSummaryResult[] };
}

export class YahooFinanceClient implements MarketDataClient, MarketEventsClient {
  private crumb: string | null = null;
  private cookie = "";

  async getQuote(ticker: string): Promise<Quote> {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=1m`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Yahoo quote ${ticker}: HTTP ${response.status}`);

    const data = (await response.json()) as ChartResponse;
    const result = data.chart?.result?.[0];
    if (!result) throw new Error(`No quote data for ${ticker}.`);

    const meta = result.meta;
    const rawQuote = result.indicators?.quote?.[0] ?? {};
    const highs = (rawQuote.high ?? []).filter((value): value is number => value != null && value > 0);
    const lows = (rawQuote.low ?? []).filter((value): value is number => value != null && value > 0);

    const dividendRate = meta.trailingAnnualDividendRate || (await this.fetchDividendRateFallback(ticker));

    return {
      ticker,
      priceCents: Math.round(meta.regularMarketPrice * 100),
      previousCloseCents: Math.round((meta.chartPreviousClose ?? meta.previousClose ?? 0) * 100),
      shortName: meta.shortName,
      dayHighCents: highs.length ? Math.round(Math.max(...highs) * 100) : 0,
      dayLowCents: lows.length ? Math.round(Math.min(...lows) * 100) : 0,
      dividendRateCents: Math.round(dividendRate * 100),
    };
  }

  async getHistory(ticker: string, range: string, interval: string): Promise<PricePoint[]> {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Yahoo history ${ticker}: HTTP ${response.status}`);

    const data = (await response.json()) as ChartResponse;
    const result = data.chart?.result?.[0];
    if (!result) return [];

    const timestamps = result.timestamp ?? [];
    const closes = result.indicators?.quote?.[0]?.close ?? [];
    const volumes = result.indicators?.quote?.[0]?.volume ?? [];
    return timestamps
      .map((timestamp, index): PricePoint | undefined => {
        const close = closes[index];
        const volume = volumes[index];
        return close == null
          ? undefined
          : { timestamp, closeCents: Math.round(close * 100), volume: volume ?? undefined };
      })
      .filter((point): point is PricePoint => point !== undefined);
  }

  /**
   * Dividends and splits ride along with the price bars, so they cost nothing
   * extra; earnings need a separate quoteSummary call. Every leg is best-effort
   * — an events strip is a nice-to-have on a chart, not a reason to fail the
   * whole request.
   */
  async getEvents(ticker: string, range: string): Promise<MarketEvent[]> {
    const [corporate, earnings] = await Promise.all([
      this.fetchCorporateActions(ticker, range).catch((): MarketEvent[] => []),
      this.fetchEarningsHistory(ticker).catch((): MarketEvent[] => []),
    ]);

    return [...corporate, ...earnings].sort((a, b) => a.timestamp - b.timestamp);
  }

  private async fetchCorporateActions(ticker: string, range: string): Promise<MarketEvent[]> {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=1d&events=div,split`;
    const response = await fetch(url);
    if (!response.ok) return [];

    const data = (await response.json()) as ChartResponse;
    const events = data.chart?.result?.[0]?.events;
    if (!events) return [];

    const dividends = Object.values(events.dividends ?? {})
      .filter((entry) => entry.date != null)
      .map<MarketEvent>((entry) => ({
        timestamp: entry.date as number,
        kind: "dividend",
        amountCents: entry.amount != null ? Math.round(entry.amount * 100) : undefined,
      }));

    const splits = Object.values(events.splits ?? {})
      .filter((entry) => entry.date != null)
      .map<MarketEvent>((entry) => ({
        timestamp: entry.date as number,
        kind: "split",
        ratio:
          entry.splitRatio ??
          (entry.numerator != null && entry.denominator != null
            ? `${entry.numerator}:${entry.denominator}`
            : undefined),
      }));

    return [...dividends, ...splits];
  }

  private async fetchEarningsHistory(ticker: string): Promise<MarketEvent[]> {
    const result = await this.fetchQuoteSummary(ticker, "earningsHistory");
    const history = result?.earningsHistory?.history ?? [];

    return history
      .filter((entry) => entry.quarter?.raw != null)
      .map<MarketEvent>((entry) => ({
        timestamp: entry.quarter?.raw as number,
        kind: "earnings",
        epsActualCents:
          entry.epsActual?.raw != null ? Math.round(entry.epsActual.raw * 100) : undefined,
        epsEstimateCents:
          entry.epsEstimate?.raw != null ? Math.round(entry.epsEstimate.raw * 100) : undefined,
      }));
  }

  // v8 chart metadata often omits the dividend rate — v10 quoteSummary has it, but
  // requires a crumb token obtained from a short-lived cookie session.
  private async fetchDividendRateFallback(ticker: string): Promise<number> {
    const result = await this.fetchQuoteSummary(ticker, "summaryDetail");
    return result?.summaryDetail?.trailingAnnualDividendRate?.raw ?? 0;
  }

  /**
   * One quoteSummary read, with the crumb dance around it: try with the current
   * crumb, and fall back to an anonymous request if that's rejected. Returns
   * undefined rather than throwing — every caller treats a failure here as
   * "the provider didn't say", not as an error worth surfacing.
   */
  private async fetchQuoteSummary(
    ticker: string,
    modules: string,
  ): Promise<QuoteSummaryResult | undefined> {
    try {
      if (!this.crumb) await this.refreshCrumb();
      if (this.crumb) {
        const result = await this.requestQuoteSummary(ticker, modules, true);
        if (result !== undefined) return result;
      }
      return await this.requestQuoteSummary(ticker, modules, false);
    } catch {
      return undefined;
    }
  }

  private async requestQuoteSummary(
    ticker: string,
    modules: string,
    withCrumb: boolean,
  ): Promise<QuoteSummaryResult | undefined> {
    const encoded = encodeURIComponent(ticker);
    const query = `modules=${encodeURIComponent(modules)}`;
    const url = withCrumb
      ? `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encoded}?${query}&crumb=${encodeURIComponent(this.crumb ?? "")}`
      : `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encoded}?${query}`;

    const response = await fetch(url, withCrumb ? { headers: { Cookie: this.cookie } } : undefined);
    if (response.status === 401 || response.status === 403) {
      // The crumb went stale. Refresh it for next time and let the caller retry
      // anonymously rather than looping here.
      if (withCrumb) {
        await this.refreshCrumb();
        return undefined;
      }
    }
    if (!response.ok) return undefined;

    const data = (await response.json()) as QuoteSummaryResponse;
    return data.quoteSummary?.result?.[0];
  }

  private async refreshCrumb(): Promise<void> {
    try {
      const cookieResponse = await fetch("https://fc.yahoo.com/cupcake", { redirect: "manual" });
      // Node's undici Headers exposes getSetCookie() for multi-value Set-Cookie;
      // fall back to the single-value get() if it's ever unavailable.
      const headers = cookieResponse.headers as Headers & { getSetCookie?: () => string[] };
      this.cookie = headers.getSetCookie ? headers.getSetCookie().join("; ") : headers.get("set-cookie") ?? "";

      const crumbResponse = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
        headers: { Cookie: this.cookie },
      });
      if (!crumbResponse.ok) {
        this.crumb = null;
        return;
      }

      const text = await crumbResponse.text();
      this.crumb = text && text.length < 50 && !text.includes("<") ? text : null;
    } catch {
      this.crumb = null;
    }
  }
}
