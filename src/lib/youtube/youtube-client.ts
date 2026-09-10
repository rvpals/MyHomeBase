import { parseSearchResults } from "./parse";
import { buildSearchTerm, pickBestCandidate, youtubeSearchUrl } from "./youtube";
import type { VideoClient } from "./ports";
import type { VideoCandidate, VideoLookup, VideoQuery } from "./types";

// YouTube publishes no free search API -- the official Data API v3 charges 100 quota
// units per search against a 10,000/day allowance, which is ~100 lookups a day and
// needs a Google Cloud key. So this reads the public results page, exactly as the
// Songfacts client reads that site's pages.
//
// Two requests at most per lookup, and the second is optional:
//   1. GET /results  -- the search, parsed for candidates.
//   2. GET /oembed   -- YouTube's *official*, keyless endpoint, to confirm the pick
//                       still exists and to take its canonical title/channel.
//
// Unlike the search scrape, oEmbed is documented and stable, so a disagreement
// between the two is resolved in oEmbed's favour.

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * A video for a song, from youtube.com -- free, no API key, no account.
 *
 * Strategy: search, rank (see `youtube.ts`), verify the winner via oEmbed. Returns
 * `not_found` rather than a shrug when nothing clears the score floor -- an embedded
 * karaoke track under the listener's song title is worse than a search link.
 *
 * Nothing is cached here. Caching is the caller's job, and the music module does it in
 * `mus_track_video` -- this client is stateless so a second module could reuse it.
 */
export class YouTubeVideoClient implements VideoClient {
  async lookup(query: VideoQuery): Promise<VideoLookup> {
    const searchUrl = youtubeSearchUrl(query);
    if (buildSearchTerm(query) === "") return { status: "not_found", searchUrl };

    // A failed search is a thrown error, not a miss: the caller must be able to tell
    // "YouTube is unreachable" from "YouTube has nothing", and only one is retried
    // eagerly.
    const html = await this.getSearchPage(searchUrl);

    const candidates = parseSearchResults(html);
    const best = pickBestCandidate(candidates, query);
    if (best === undefined) return { status: "not_found", searchUrl };

    return { status: "found", video: await this.verify(best), searchUrl };
  }

  /** The results page. Throws when it cannot be read -- see `lookup`. */
  private async getSearchPage(url: string): Promise<string> {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html",
        // Without this YouTube localises titles and duration badges to the server's
        // guess, and `parseDurationBadge` only understands digits and colons.
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });

    if (!response.ok) throw new Error(`YouTube search returned HTTP ${response.status}.`);
    return response.text();
  }

  /**
   * Confirms a pick against oEmbed and prefers its metadata.
   *
   * Best-effort by design: a candidate that fails verification is still returned as
   * scraped. oEmbed 404s for a video that is private or region-blocked, but it also
   * fails on a transient hiccup, and discarding a good pick over that would be worse
   * than showing a title that turns out to be stale.
   */
  private async verify(candidate: VideoCandidate): Promise<VideoCandidate> {
    try {
      const target = `https://www.youtube.com/watch?v=${encodeURIComponent(candidate.videoId)}`;
      const response = await fetch(
        `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(target)}`,
        { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } },
      );
      if (!response.ok) return candidate;

      const payload: unknown = await response.json();
      if (payload === null || typeof payload !== "object") return candidate;

      const { title, author_name: author } = payload as { title?: unknown; author_name?: unknown };
      return {
        ...candidate,
        title: typeof title === "string" && title !== "" ? title : candidate.title,
        channel: typeof author === "string" && author !== "" ? author : candidate.channel,
      };
    } catch {
      return candidate;
    }
  }
}
