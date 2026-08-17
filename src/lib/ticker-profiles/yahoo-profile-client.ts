// Sector/industry from Yahoo's `assetProfile`, over the QuoteSummaryClient the
// ticker detail tab already uses. No new service, no key, no cost.
//
// A thin adapter rather than a second HTTP client: `getQuoteSummary` already
// handles Yahoo's crumb/cookie handshake, and duplicating that is how the two
// copies drift.

import type { QuoteSummaryClient } from "@/lib/market-data";
import type { TickerProfileClient } from "./ports";
import type { FetchedProfile } from "./types";

/** A trimmed string, or blank. A whitespace-only sector is not an answer. */
function text(value?: string): string {
  return value?.trim() ?? "";
}

export class YahooTickerProfileClient implements TickerProfileClient {
  readonly source = "yahoo:assetProfile";

  constructor(private client: QuoteSummaryClient) {}

  /**
   * Blank fields mean Yahoo answered without a sector — normal for a fund, and
   * cached as such. A failed request throws, which is what keeps an outage out
   * of the cache: `getQuoteSummary` already throws when the provider returns
   * nothing, and a 401 from a failed crumb handshake surfaces the same way.
   */
  async fetch(ticker: string): Promise<FetchedProfile> {
    const raw = await this.client.getQuoteSummary(ticker);
    return {
      sector: text(raw.assetProfile?.sector),
      industry: text(raw.assetProfile?.industry),
    };
  }
}
