import type { MarketDataClient, MarketEventsClient, QuoteSummaryClient } from "./ports";
import type { MarketEvent, PricePoint, Quote, RawQuoteSummary } from "./types";

/**
 * The quoteSummary modules the detail tab reads, fetched as one request.
 * Verified against the live endpoint — every one of these returns data.
 */
const DETAIL_MODULES = [
  "price",
  "summaryDetail",
  "assetProfile",
  "defaultKeyStatistics",
  "financialData",
  "recommendationTrend",
  "upgradeDowngradeHistory",
  "incomeStatementHistory",
] as const;

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
        open?: (number | null)[];
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

/**
 * Sent on every request to Yahoo.
 *
 * Not cosmetic: without a browser User-Agent, `v1/test/getcrumb` answers **429
 * Too Many Requests** on the very first call of a session. No crumb means the
 * v10 quoteSummary endpoints 401, and both callers swallow that — so earnings
 * history came back empty and the dividend-rate fallback silently returned 0,
 * with nothing in the logs to say why. Node's default `undici` agent string is
 * what trips it; any normal browser string is accepted.
 */
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export class YahooFinanceClient
  implements MarketDataClient, MarketEventsClient, QuoteSummaryClient
{
  private crumb: string | null = null;
  private cookie = "";
  /** In-flight crumb refresh, if any. See `refreshCrumb`. */
  private crumbRefresh: Promise<void> | null = null;

  async getQuote(ticker: string): Promise<Quote> {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=1m`;
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
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
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!response.ok) throw new Error(`Yahoo history ${ticker}: HTTP ${response.status}`);

    const data = (await response.json()) as ChartResponse;
    const result = data.chart?.result?.[0];
    if (!result) return [];

    const timestamps = result.timestamp ?? [];
    const rawQuote = result.indicators?.quote?.[0] ?? {};
    const closes = rawQuote.close ?? [];
    const volumes = rawQuote.volume ?? [];
    // The rest of the bar rides along in the same response — it always did; this
    // client simply used to drop it. Reading it costs no extra request.
    const opens = rawQuote.open ?? [];
    const highs = rawQuote.high ?? [];
    const lows = rawQuote.low ?? [];

    return timestamps
      .map((timestamp, index): PricePoint | undefined => {
        const close = closes[index];
        if (close == null) return undefined;

        // All three or none: half a candle can't be drawn, and a bar missing its
        // open would otherwise render as a body of zero height at the wrong place.
        const open = opens[index];
        const high = highs[index];
        const low = lows[index];
        const hasBar = open != null && high != null && low != null;

        return {
          timestamp,
          closeCents: Math.round(close * 100),
          volume: volumes[index] ?? undefined,
          ...(hasBar
            ? {
                openCents: Math.round(open * 100),
                highCents: Math.round(high * 100),
                lowCents: Math.round(low * 100),
              }
            : {}),
        };
      })
      .filter((point): point is PricePoint => point !== undefined);
  }

  /**
   * The whole reference record in **one** request.
   *
   * quoteSummary takes a comma-separated module list, so twelve sections cost
   * the same round-trip as one — which is why the detail tab is a single fetch
   * rather than six. Absent modules are normal and left to the caller.
   */
  async getQuoteSummary(ticker: string): Promise<RawQuoteSummary> {
    const result = await this.fetchQuoteSummary(ticker, DETAIL_MODULES.join(","));
    if (!result) throw new Error(`Yahoo detail ${ticker}: the provider returned nothing.`);
    return result as RawQuoteSummary;
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
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
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

    const response = await fetch(url, {
      headers: withCrumb
        ? { Cookie: this.cookie, "User-Agent": USER_AGENT }
        : { "User-Agent": USER_AGENT },
    });
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

  /**
   * Refresh the cookie/crumb pair, **at most once at a time**.
   *
   * The single-flight matters: opening the ticker dialog fires several
   * use-cases at once, and two of them reach quoteSummary (the quote's
   * dividend-rate fallback, and the earnings history). Both would find no crumb
   * and both would refresh — the second overwriting `cookie` while the first
   * was still using the crumb minted for the old one. Yahoo pairs the two, so
   * the mismatch 401s and both callers fall back to an anonymous request that
   * also 401s. The symptom was an earnings list that worked in isolation and
   * was empty whenever anything else ran alongside it.
   */
  private refreshCrumb(): Promise<void> {
    this.crumbRefresh ??= this.performCrumbRefresh().finally(() => {
      this.crumbRefresh = null;
    });
    return this.crumbRefresh;
  }

  private async performCrumbRefresh(): Promise<void> {
    try {
      const cookieResponse = await fetch("https://fc.yahoo.com/cupcake", {
        redirect: "manual",
        headers: { "User-Agent": USER_AGENT },
      });
      // Node's undici Headers exposes getSetCookie() for multi-value Set-Cookie;
      // fall back to the single-value get() if it's ever unavailable.
      const headers = cookieResponse.headers as Headers & { getSetCookie?: () => string[] };
      this.cookie = headers.getSetCookie ? headers.getSetCookie().join("; ") : headers.get("set-cookie") ?? "";

      const crumbResponse = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
        headers: { Cookie: this.cookie, "User-Agent": USER_AGENT },
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
