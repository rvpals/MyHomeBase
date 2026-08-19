import { isDurationMatch, shouldSendDuration, type LyricsQuery } from "./lyrics";
import type { LyricsClient, LyricsLookupResult } from "./ports";

const LRCLIB_BASE = "https://lrclib.net/api";

// LRCLIB asks clients to identify themselves and link back, in place of the API key
// and rate limit it deliberately does not have. Honouring that is the whole cost of
// using the service, so it is not optional.
const USER_AGENT = "MyHomeBase/0.1.0 (self-hosted personal music library)";

/** The subset of LRCLIB's response this module reads. */
interface LrclibTrack {
  trackName?: string;
  artistName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

/**
 * Lyrics from LRCLIB (https://lrclib.net) -- free, no API key, no rate limit.
 *
 * Strategy, in order:
 *
 *   1. `/api/get` with artist + title. The exact lookup, and the common case.
 *   2. `/api/get` again with the duration, if we have one -- narrows a title that
 *      several recordings share.
 *   3. `/api/search` free-text, then pick the best duration match. The fallback for
 *      when tags are spelled differently than the contributor spelled them.
 *
 * Duration is NOT sent on the first attempt on purpose: LRCLIB matches it strictly,
 * so a slightly different mastering turns a hit into a 404. It is a tie-breaker, not
 * a filter.
 *
 * Only plain lyrics are returned. `syncedLyrics` comes back on the same call and is
 * deliberately ignored -- rendering it needs an LRC parser and a per-frame sync loop
 * against the audio element, which is not built.
 */
export class LrclibLyricsClient implements LyricsClient {
  async lookup(query: LyricsQuery): Promise<LyricsLookupResult> {
    // Step 1: the exact lookup.
    const exact = await this.get(query, false);
    if (exact !== undefined) return exact;

    // Step 2: same lookup, narrowed by duration.
    if (shouldSendDuration(query.durationSeconds)) {
      const narrowed = await this.get(query, true);
      if (narrowed !== undefined) return narrowed;
    }

    // Step 3: free-text search, then the closest duration.
    return this.search(query);
  }

  private async get(query: LyricsQuery, withDuration: boolean): Promise<LyricsLookupResult | undefined> {
    const params = new URLSearchParams({
      artist_name: query.artist,
      track_name: query.title,
    });
    if (query.album !== undefined && query.album !== "") params.set("album_name", query.album);
    if (withDuration && query.durationSeconds !== undefined) {
      params.set("duration", String(Math.round(query.durationSeconds)));
    }

    const response = await fetch(`${LRCLIB_BASE}/get?${params.toString()}`, {
      headers: { "User-Agent": USER_AGENT },
    });

    // 404 is LRCLIB's documented "no such track" and is not an error -- it just means
    // this attempt missed, so the caller moves on to the next strategy.
    if (response.status === 404) return undefined;
    if (!response.ok) {
      throw new Error(
        `LRCLIB lookup failed (HTTP ${response.status}) for "${query.artist} - ${query.title}".`,
      );
    }

    return toResult((await response.json()) as LrclibTrack);
  }

  private async search(query: LyricsQuery): Promise<LyricsLookupResult> {
    const term = [query.artist, query.title].filter((part) => part !== "").join(" ");
    const response = await fetch(
      `${LRCLIB_BASE}/search?q=${encodeURIComponent(term)}`,
      { headers: { "User-Agent": USER_AGENT } },
    );

    if (!response.ok) {
      throw new Error(`LRCLIB search failed (HTTP ${response.status}) for "${term}".`);
    }

    const candidates = (await response.json()) as LrclibTrack[];
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return { status: "not_found" };
    }

    // Prefer a candidate whose length matches ours; a title can be shared by a studio
    // cut, a live version and a cover, and length is the cheapest way to tell them
    // apart. Falls back to the first result when we have no duration to compare.
    const best =
      candidates.find(
        (candidate) =>
          hasWords(candidate) && isDurationMatch(query.durationSeconds, candidate.duration),
      ) ??
      candidates.find(hasWords) ??
      candidates[0];

    return toResult(best);
  }
}

function hasWords(candidate: LrclibTrack): boolean {
  return typeof candidate.plainLyrics === "string" && candidate.plainLyrics.trim() !== "";
}

/**
 * Maps one LRCLIB record onto our three real outcomes.
 *
 * `instrumental` is checked before the lyric body: a track flagged instrumental comes
 * back with `plainLyrics: null`, and treating that as "not found" would mean
 * re-requesting it every time the listener opened the song.
 */
function toResult(candidate: LrclibTrack | undefined): LyricsLookupResult {
  if (candidate === undefined) return { status: "not_found" };

  if (candidate.instrumental === true) {
    return { status: "instrumental", matchedArtist: candidate.artistName, matchedTitle: candidate.trackName };
  }

  const plain = candidate.plainLyrics;
  if (typeof plain === "string" && plain.trim() !== "") {
    return {
      status: "found",
      lyrics: plain.trim(),
      matchedArtist: candidate.artistName,
      matchedTitle: candidate.trackName,
    };
  }

  return { status: "not_found" };
}
