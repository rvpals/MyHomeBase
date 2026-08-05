import type { RawNewsStory } from "./types";

export interface TickerNewsClient {
  /**
   * Recent stories the provider associates with this ticker, newest first is
   * preferred but not required — the use-case ranks them itself. Returns an empty
   * list rather than throwing when the provider simply has nothing.
   */
  searchStories(ticker: string, limit: number): Promise<RawNewsStory[]>;
}
