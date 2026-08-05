import { todayIsoLocal, toIsoDateLocal } from "@/lib/shared/date";
import type { TickerNewsClient } from "./ports";
import { newsTickerSchema } from "./schema";
import type { RawNewsStory, TopNewsStory } from "./types";

/** How many stories to ask the provider for before ranking them down to one. */
export const NEWS_SEARCH_LIMIT = 8;

/**
 * Whether the ticker is what the story is actually about, rather than one of the
 * symbols it happens to mention.
 *
 * Providers tag liberally: a story headlined "AMD Stock Tumbles" comes back tagged
 * `["AMD", "SPCX", "NVDA"]` and would otherwise be served as NVDA's top story,
 * which is exactly the wrong answer for "what moved NVDA today". Two signals say
 * it's the real subject: the provider listed it first, or the headline names it.
 */
export function isPrimarySubject(story: RawNewsStory, ticker: string): boolean {
  const upper = ticker.toUpperCase();
  if (story.relatedTickers[0]?.toUpperCase() === upper) return true;
  // Word-boundary match so "NET" doesn't hit "NETWORK" and "C" doesn't hit every
  // capital letter in the headline.
  return new RegExp(`\\b${upper.replace(/[.\-^]/g, "\\$&")}\\b`).test(story.title.toUpperCase());
}

function publishedOn(story: RawNewsStory): string {
  const date = new Date(story.publishedAt);
  return Number.isNaN(date.getTime()) ? "" : toIsoDateLocal(date);
}

/**
 * Picks the single story most likely to explain today's move, or undefined when
 * the provider returned nothing usable.
 *
 * Today's stories are preferred over older ones, and within a day a story the
 * ticker leads beats one that merely mentions it; newest breaks the remaining
 * ties. When nothing was published today the newest story is still returned, but
 * flagged `isFromToday: false` so the UI can say so instead of implying a
 * three-day-old article explains this morning.
 */
export function pickTopStory(
  stories: RawNewsStory[],
  ticker: string,
  today: string = todayIsoLocal(),
): TopNewsStory | undefined {
  const usable = stories.filter((story) => story.title.trim() !== "" && story.url.trim() !== "");
  if (usable.length === 0) return undefined;

  const fromToday = usable.filter((story) => publishedOn(story) === today);
  const candidates = fromToday.length > 0 ? fromToday : usable;

  const best = [...candidates].sort((a, b) => {
    const primary = Number(isPrimarySubject(b, ticker)) - Number(isPrimarySubject(a, ticker));
    if (primary !== 0) return primary;
    return Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
  })[0];

  return {
    ...best,
    ticker: ticker.toUpperCase(),
    isFromToday: fromToday.length > 0,
    isPrimarySubject: isPrimarySubject(best, ticker),
  };
}

/**
 * Fetches and ranks the top story for one ticker. Returns undefined when there's
 * no news rather than throwing — "nothing published" is a normal answer, and a
 * quiet ticker shouldn't surface as an error. A provider *failure* still throws,
 * so the caller can tell "no news" apart from "the lookup broke".
 */
export async function getTopStory(
  client: TickerNewsClient,
  ticker: string,
  today: string = todayIsoLocal(),
): Promise<TopNewsStory | undefined> {
  const validated = newsTickerSchema.parse(ticker);
  const stories = await client.searchStories(validated, NEWS_SEARCH_LIMIT);
  return pickTopStory(stories, validated, today);
}
