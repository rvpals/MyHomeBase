import { deriveStoryQuery } from "./story";
import { isRetryable, type TrackVideo } from "./video";
import type { MusicRepository } from "./ports";
import { youtubeSearchUrl, type VideoClient, type VideoQuery } from "@/lib/youtube";

// The video use-case: what happens when the listener presses "Find video".
//
// Orchestration only -- the search terms come from story.ts, the ranking from
// src/lib/youtube, the row shape from video.ts.
//
// Two things distinguish this from the story path it otherwise resembles:
//
//   - It **caches**. A video id is stable more or less forever, so a second visit to a
//     track costs zero requests. See migrations/0086.
//   - It is **never automatic**. The button is the trigger. Auto-fetching per played
//     track would mean scraping a free service for a video the listener never asked to
//     see, and auto-fetching on scan would mean 20,272 of them.

export interface FetchVideoDependencies {
  musicRepo: MusicRepository;
  videoClient: VideoClient;
}

export type FetchVideoOutcome =
  | { kind: "found"; video: TrackVideo; searchUrl: string; fromCache: boolean }
  | { kind: "not-found"; searchUrl: string }
  | { kind: "failed"; searchUrl: string }
  | { kind: "unsearchable"; reason: string }
  | { kind: "no-such-track" };

/**
 * The cached pick for a track, without going near the network.
 *
 * What the Video tab calls on mount, so a track you have already looked up shows its
 * video immediately and the button reads "Refresh" rather than "Find video".
 */
export function readCachedVideo(
  deps: Pick<FetchVideoDependencies, "musicRepo">,
  trackId: number,
): FetchVideoOutcome | undefined {
  const cached = deps.musicRepo.getTrackVideo(trackId);
  if (cached === undefined) return undefined;

  const searchUrl = youtubeSearchUrl({
    artist: cached.searchArtist,
    title: cached.searchTitle,
  });

  if (cached.status === "found") {
    return { kind: "found", video: cached, searchUrl, fromCache: true };
  }
  // A remembered miss is reported as a miss, but the tab still offers "Try again" --
  // see `isRetryable`: no miss here is ever permanent.
  return { kind: cached.status === "not_found" ? "not-found" : "failed", searchUrl };
}

/**
 * Finds the YouTube video for a track, using the cache unless asked not to.
 *
 * `force` is the Refresh path: it bypasses a cached *hit* so a wrong pick can be
 * replaced. A cached miss is retried without it, because a miss is as likely to be our
 * ranking being strict as YouTube being empty.
 *
 * The unhappy outcomes stay distinct because the tab needs different words for each:
 *
 *   - `unsearchable` -- no artist, so no query can be built. Tagging the file fixes
 *                       it, and no request is made.
 *   - `not-found`    -- the search ran and nothing was worth standing behind. Carries
 *                       a YouTube search URL so the listener can settle it themselves.
 *   - `failed`       -- YouTube could not be reached, or sent a payload we no longer
 *                       parse. Nothing is wrong with the song.
 */
export async function fetchTrackVideo(
  deps: FetchVideoDependencies,
  trackId: number,
  force = false,
): Promise<FetchVideoOutcome> {
  const track = deps.musicRepo.getTrack(trackId);
  if (track === undefined) return { kind: "no-such-track" };

  if (!force) {
    const cached = deps.musicRepo.getTrackVideo(trackId);
    // Only a *hit* short-circuits. A cached miss falls through and is retried.
    if (cached !== undefined && !isRetryable(cached)) {
      const outcome = readCachedVideo(deps, trackId);
      if (outcome !== undefined) return outcome;
    }
  }

  // Reuses the story path's query derivation, so a track that finds its story finds
  // its video too -- and an untagged file falls back to its `Artist - Title.mp3`
  // filename the same way.
  const derived = deriveStoryQuery(track);
  if (derived === undefined) {
    return {
      kind: "unsearchable",
      reason:
        "This track needs an artist and a title before its video can be found - YouTube is searched by name.",
    };
  }

  // The track's own length is what rejects hour-long compilations, so it is passed
  // when the file carries it.
  const query: VideoQuery = { ...derived, durationSeconds: track.durationSeconds };
  const searchUrl = youtubeSearchUrl(query);

  try {
    const lookup = await deps.videoClient.lookup(query);

    if (lookup.status === "found" && lookup.video !== undefined) {
      const video: Omit<TrackVideo, "fetchedAt"> = {
        trackId,
        status: "found",
        videoId: lookup.video.videoId,
        videoTitle: lookup.video.title,
        channel: lookup.video.channel,
        durationSeconds: lookup.video.durationSeconds,
        source: "youtube",
        searchArtist: query.artist,
        searchTitle: query.title,
      };
      deps.musicRepo.saveTrackVideo(video);

      // Re-read rather than synthesising a fetchedAt: the database owns that clock,
      // and inventing one here would drift from what the next page load shows.
      const stored = deps.musicRepo.getTrackVideo(trackId);
      return {
        kind: "found",
        video: stored ?? { ...video, fetchedAt: "" },
        searchUrl: lookup.searchUrl,
        fromCache: false,
      };
    }

    // A miss is cached too, so pressing the button twice in a row does not scrape
    // twice. It stays retryable -- the row records why, not a verdict.
    deps.musicRepo.saveTrackVideo(missRow(trackId, "not_found", query));
    return { kind: "not-found", searchUrl: lookup.searchUrl };
  } catch {
    deps.musicRepo.saveTrackVideo(missRow(trackId, "failed", query));
    return { kind: "failed", searchUrl };
  }
}

/** A row recording a miss: the status and what was asked, nothing more. */
function missRow(
  trackId: number,
  status: "not_found" | "failed",
  query: VideoQuery,
): Omit<TrackVideo, "fetchedAt"> {
  return {
    trackId,
    status,
    videoId: "",
    videoTitle: "",
    channel: "",
    durationSeconds: undefined,
    source: "youtube",
    searchArtist: query.artist,
    searchTitle: query.title,
  };
}
