import { deriveLyricsQuery, shouldRefetchLyrics, type TrackLyrics } from "./lyrics";
import type { LyricsClient, MusicRepository } from "./ports";

// The lyrics use-case: what happens when the listener presses the button.
//
// Orchestration only -- the search terms come from lyrics.ts, the request from a
// LyricsClient, the cache from a MusicRepository. Nothing here touches a network or a
// database directly, which is what lets it be tested offline.

export interface FetchLyricsDependencies {
  musicRepo: MusicRepository;
  lyricsClient: LyricsClient;
}

export type FetchLyricsOutcome =
  | { kind: "cached"; lyrics: TrackLyrics }
  | { kind: "fetched"; lyrics: TrackLyrics }
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
    return { kind: "cached", lyrics: cached as TrackLyrics };
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

  try {
    const result = await deps.lyricsClient.lookup(query);
    const lyrics: Omit<TrackLyrics, "fetchedAt"> = {
      ...base,
      status: result.status,
      lyrics: result.status === "found" ? (result.lyrics ?? "") : "",
    };
    deps.musicRepo.saveTrackLyrics(lyrics);
    return { kind: "fetched", lyrics: deps.musicRepo.getTrackLyrics(trackId) ?? { ...lyrics, fetchedAt: "" } };
  } catch {
    // The request itself failed -- record it as retryable and let the UI say so.
    const lyrics: Omit<TrackLyrics, "fetchedAt"> = { ...base, status: "failed", lyrics: "" };
    deps.musicRepo.saveTrackLyrics(lyrics);
    return { kind: "fetched", lyrics: deps.musicRepo.getTrackLyrics(trackId) ?? { ...lyrics, fetchedAt: "" } };
  }
}

/** A track's cached lyrics without fetching anything -- what the player reads on open. */
export function getCachedLyrics(
  musicRepo: MusicRepository,
  trackId: number,
): TrackLyrics | undefined {
  return musicRepo.getTrackLyrics(trackId);
}
