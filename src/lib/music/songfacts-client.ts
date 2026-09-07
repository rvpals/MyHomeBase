import { parseSongfacts, parseSongfactsSubject } from "./songfacts-parse";
import { songfactsCandidates, type SongStory, type StoryQuery } from "./story";
import type { StoryClient } from "./ports";

// Songfacts identifies its pages by a slug, not a query, and publishes no API. The
// same courtesy the lyrics client extends to LRCLIB applies here for stronger reasons:
// this is a free editorial site being read by a scraper, so it gets an honest
// User-Agent and the smallest number of requests that can work.
const USER_AGENT = "MyHomeBase/0.1.0 (self-hosted personal music library)";

/**
 * The story behind a song, from songfacts.com -- free, no API key, no account.
 *
 * Strategy: derive a small list of candidate URLs (see `songfactsCandidates`) and GET
 * them in order until one returns a page with facts on it. First hit wins.
 *
 * There is deliberately **no search fallback**. Songfacts' robots.txt disallows
 * `/search` for every user agent, so when the guesses miss, the honest outcome is
 * `not_found` plus a search URL for the listener to open themselves -- which is what
 * the player shows. Guessing harder is not worth fetching a path we have been asked
 * not to touch.
 *
 * Nothing is cached: `MusicRepository` is not a dependency here and no table backs
 * this. One lookup per track played.
 */
export class SongfactsStoryClient implements StoryClient {
  async lookup(query: StoryQuery): Promise<SongStory> {
    const candidates = songfactsCandidates(query);
    if (candidates.length === 0) return notFound();

    // Counts how many candidates failed for a reason that is *not* "no such page", so
    // an unreachable site is reported as `failed` (worth another play) rather than as
    // "Songfacts has no story for this song", which would be a confident wrong answer.
    let requestFailures = 0;

    for (const url of candidates) {
      try {
        const html = await this.get(url);
        // 404 is the expected outcome of a wrong guess, not an error. Try the next.
        if (html === undefined) continue;

        const facts = parseSongfacts(html);
        // A page can exist with no facts list -- a song nobody has written about yet.
        // Treat it as a miss so a later candidate still gets its turn.
        if (facts.length === 0) continue;

        const subject = parseSongfactsSubject(html);
        return {
          status: "found",
          facts,
          sourceUrl: url,
          matchedTitle: subject?.title,
          matchedArtist: subject?.artist,
        };
      } catch {
        requestFailures += 1;
      }
    }

    if (requestFailures === candidates.length) {
      throw new Error(`Could not reach Songfacts for "${query.artist} - ${query.title}".`);
    }
    return notFound();
  }

  /** One page, or `undefined` for a 404 -- the normal result of a wrong slug guess. */
  private async get(url: string): Promise<string | undefined> {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      redirect: "follow",
    });

    if (response.status === 404 || response.status === 410) return undefined;
    if (!response.ok) throw new Error(`Songfacts returned HTTP ${response.status} for ${url}.`);

    return response.text();
  }
}

function notFound(): SongStory {
  return { status: "not_found", facts: [], sourceUrl: "" };
}
