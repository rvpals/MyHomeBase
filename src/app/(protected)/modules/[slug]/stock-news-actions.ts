"use server";

import { todayIsoLocal } from "@/lib/shared/date";
import { getTopStory, type TopNewsStory } from "@/lib/ticker-news";
import { deps } from "@/lib/wiring";

export interface TopStoryResult {
  ok: boolean;
  /** Absent with `ok: true` means the provider simply had nothing for this ticker. */
  story?: TopNewsStory;
  error?: string;
}

/**
 * The top story for one ticker, fetched on demand when the news button is pressed.
 *
 * Not prefetched with the dashboard: that would be ten upstream calls on every page
 * load for stories nobody asked to read. Not cached either — a headline is only
 * interesting while it's fresh, and the button is already an explicit "get me this
 * now".
 */
export async function fetchTopStoryAction(ticker: string): Promise<TopStoryResult> {
  try {
    const story = await getTopStory(deps.tickerNewsClient, ticker, todayIsoLocal());
    return { ok: true, story };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not reach the news provider.",
    };
  }
}
