import type { MarketDataClient } from "./ports";
import type { PricePoint, Quote } from "./types";

// Yahoo Finance's unofficial, unauthenticated chart/quoteSummary endpoints — no API
// key, but no SLA either. The v10 quoteSummary calls (used only for the dividend-rate
// fallback) need a session cookie + "crumb" token; query1/query2 chart endpoints don't.
// Ported from the source PWA's server/services/yahoo-finance.js.

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
}

interface ChartResponse {
  chart?: { result?: ChartResult[] };
}

interface QuoteSummaryResponse {
  quoteSummary?: {
    result?: [{ summaryDetail?: { trailingAnnualDividendRate?: { raw?: number } } }];
  };
}

export class YahooFinanceClient implements MarketDataClient {
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

  // v8 chart metadata often omits the dividend rate — v10 quoteSummary has it, but
  // requires a crumb token obtained from a short-lived cookie session.
  private async fetchDividendRateFallback(ticker: string): Promise<number> {
    try {
      if (!this.crumb) await this.refreshCrumb();
      if (this.crumb) {
        const rate = await this.fetchSummaryDetailDividendRate(ticker, true);
        if (rate !== undefined) return rate;
      }
      const rate = await this.fetchSummaryDetailDividendRate(ticker, false);
      return rate ?? 0;
    } catch {
      return 0;
    }
  }

  private async fetchSummaryDetailDividendRate(
    ticker: string,
    withCrumb: boolean,
  ): Promise<number | undefined> {
    const encoded = encodeURIComponent(ticker);
    const url = withCrumb
      ? `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encoded}?modules=summaryDetail&crumb=${encodeURIComponent(this.crumb ?? "")}`
      : `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encoded}?modules=summaryDetail`;

    const response = await fetch(url, withCrumb ? { headers: { Cookie: this.cookie } } : undefined);
    if (response.status === 401 || response.status === 403) {
      if (withCrumb) {
        await this.refreshCrumb();
        return undefined;
      }
    }
    if (!response.ok) return undefined;

    const data = (await response.json()) as QuoteSummaryResponse;
    return data.quoteSummary?.result?.[0]?.summaryDetail?.trailingAnnualDividendRate?.raw ?? undefined;
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
