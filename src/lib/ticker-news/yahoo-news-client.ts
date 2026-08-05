import type { TickerNewsClient } from "./ports";
import type { RawNewsStory } from "./types";

// Yahoo Finance's unofficial, unauthenticated search endpoint — the same host and
// the same no-API-key deal as the quote client in @/lib/market-data. No SLA, so
// every failure mode here is treated as "no news" or a thrown error, never a crash.

interface YahooNewsItem {
  title?: string;
  publisher?: string;
  link?: string;
  /** Epoch *seconds*, not milliseconds. */
  providerPublishTime?: number;
  relatedTickers?: string[];
}

interface YahooSearchResponse {
  news?: YahooNewsItem[];
}

// Yahoo returns 403 to an unrecognised agent on some edges.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const REQUEST_TIMEOUT_MS = 8000;

export class YahooTickerNewsClient implements TickerNewsClient {
  async searchStories(ticker: string, limit: number): Promise<RawNewsStory[]> {
    // quotesCount=0: we want headlines, not symbol matches.
    const url =
      `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(ticker)}` +
      `&quotesCount=0&newsCount=${limit}`;

    // A news lookup sits behind a button click, so it must not hang the request
    // indefinitely when Yahoo is slow.
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Yahoo news ${ticker}: HTTP ${response.status}`);

    const data = (await response.json()) as YahooSearchResponse;

    return (data.news ?? [])
      .filter((item): item is YahooNewsItem & { title: string; link: string } =>
        Boolean(item.title && item.link),
      )
      .map((item) => ({
        title: item.title.trim(),
        publisher: item.publisher?.trim() || "Unknown",
        url: item.link,
        // Seconds to milliseconds. A missing timestamp becomes the epoch, which
        // sorts last and never masquerades as today's news.
        publishedAt: new Date((item.providerPublishTime ?? 0) * 1000).toISOString(),
        relatedTickers: item.relatedTickers ?? [],
      }));
  }
}
