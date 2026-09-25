import {
  deriveLyricsQuery,
  googleLyricsSearchUrl,
  shouldRefetchLyrics,
  type TrackLyrics,
} from "./lyrics";
import type { AudioMetadataReader, LyricsClient, MusicRepository } from "./ports";

// The lyrics use-case: what happens when the listener presses the button.
//
// Orchestration only -- the search terms come from lyrics.ts, the words from either
// the file's own tags or a LyricsClient, the cache from a MusicRepository. Nothing
// here touches a network, a disk or a database directly, which is what lets it be
// tested offline.

export interface FetchLyricsDependencies {
  musicRepo: MusicRepository;
  lyricsClient: LyricsClient;
  /**
   * Optional so a caller that predates embedded lyrics keeps working -- omitting it
   * simply means every lookup goes online, which is the behaviour that shipped
   * before.
   */
  metadataReader?: AudioMetadataReader;
}

export type FetchLyricsOutcome =
  | { kind: "cached"; lyrics: TrackLyrics; searchUrl?: string }
  | { kind: "fetched"; lyrics: TrackLyrics; searchUrl?: string }
  | { kind: "unsearchable"; reason: string }
  | { kind: "no-such-track" };

/**
 * Returns a track's lyrics, fetching them once and caching the answer.
 *
 * `force` re-fetches something already cached, for the "try again" affordance -- but
 * it deliberately will not overwrite hand-entered lyrics (`source === "manual"`),
 * because losing something typed by hand to a stray button press is unrecoverable.
 *
 * A failed request is recorded as `failed`, not `not_found`. The distinction matters:
 * `failed` is retried later, whereas remembering an offline NAS as "this song has no
 * lyrics" would be a silent, permanent wrong answer.
 */
export async function fetchTrackLyrics(
  deps: FetchLyricsDependencies,
  trackId: number,
  options: { force?: boolean } = {},
): Promise<FetchLyricsOutcome> {
  const track = deps.musicRepo.getTrack(trackId);
  if (track === undefined) return { kind: "no-such-track" };

  const cached = deps.musicRepo.getTrackLyrics(trackId);

  if (cached !== undefined && cached.source === "manual") {
    return { kind: "cached", lyrics: cached };
  }
  if (!options.force && !shouldRefetchLyrics(cached)) {
    const settled = cached as TrackLyrics;
    // An 'instrumental' answer is the one cached state that ends here without words,
    // and LRCLIB is occasionally wrong about it -- so it gets the search link too.
    const query = settled.status === "found" ? undefined : deriveLyricsQuery(track);
    return {
      kind: "cached",
      lyrics: settled,
      searchUrl: query === undefined ? undefined : googleLyricsSearchUrl(query),
    };
  }

  // The file's own tags first, and only on an ordinary lookup.
  //
  // Words already inside the file are the better answer: they are the ones whoever
  // tagged this copy chose, they need no network, and they cannot match the wrong
  // recording the way a title-and-artist search can. Checking them before LRCLIB is
  // what makes a fully-tagged library work offline.
  //
  // Skipped on `force`, which is the "try again" button. By the time it is pressed
  // the listener has seen what the file offers and is asking for the other source;
  // re-reading the same tag would hand back the same words and look like nothing
  // happened.
  if (!options.force && deps.metadataReader !== undefined) {
    const embedded = await deps.metadataReader.readLyrics(track.relativePath);
    if (embedded !== undefined) {
      const lyrics: Omit<TrackLyrics, "fetchedAt"> = {
        trackId,
        status: "found",
        lyrics: embedded,
        source: "embedded",
        // Nothing was searched for -- the words came from the file. Recording the
        // tags anyway keeps `search_artist`/`search_title` meaning "what identified
        // this", which is what the player's attribution line reads.
        searchArtist: track.artist,
        searchTitle: track.title,
      };
      deps.musicRepo.saveTrackLyrics(lyrics);
      return {
        kind: "fetched",
        lyrics: deps.musicRepo.getTrackLyrics(trackId) ?? { ...lyrics, fetchedAt: "" },
      };
    }
  }

  const query = deriveLyricsQuery(track);
  if (query === undefined) {
    return {
      kind: "unsearchable",
      reason: "This track has no title tag and its filename gives nothing to search for.",
    };
  }

  const base = {
    trackId,
    searchArtist: query.artist,
    searchTitle: query.title,
    source: "lrclib",
  };

  // Offered on every outcome that is not words on screen -- a miss, an instrumental
  // that might be mislabelled, or an unreachable service. The listener is one click
  // from the answer even when all three automatic sources came up empty.
  const searchUrl = googleLyricsSearchUrl(query);

  try {
    const result = await deps.lyricsClient.lookup(query);
    const lyrics: Omit<TrackLyrics, "fetchedAt"> = {
      ...base,
      status: result.status,
      lyrics: result.status === "found" ? (result.lyrics ?? "") : "",
    };
    deps.musicRepo.saveTrackLyrics(lyrics);
    return {
      kind: "fetched",
      lyrics: deps.musicRepo.getTrackLyrics(trackId) ?? { ...lyrics, fetchedAt: "" },
      searchUrl: result.status === "found" ? undefined : searchUrl,
    };
  } catch {
    // The request itself failed -- record it as retryable and let the UI say so.
    const lyrics: Omit<TrackLyrics, "fetchedAt"> = { ...base, status: "failed", lyrics: "" };
    deps.musicRepo.saveTrackLyrics(lyrics);
    return {
      kind: "fetched",
      lyrics: deps.musicRepo.getTrackLyrics(trackId) ?? { ...lyrics, fetchedAt: "" },
      searchUrl,
    };
  }
}

/** A track's cached lyrics without fetching anything -- what the player reads on open. */
export function getCachedLyrics(
  musicRepo: MusicRepository,
  trackId: number,
): TrackLyrics | undefined {
  return musicRepo.getTrackLyrics(trackId);
}
