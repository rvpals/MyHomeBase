import type { VideoStatus } from "@/lib/youtube";

// The music module's view of a cached video pick.
//
// Deliberately thin: all the *deciding* -- which candidate is the song, what counts as
// a good enough match -- lives in src/lib/youtube, which knows nothing about tracks.
// This file is only the row shape that connects a track id to that library's answer.

/** One cached YouTube pick, as stored in `mus_track_video`. */
export interface TrackVideo {
  trackId: number;
  status: VideoStatus;
  /** The 11-character YouTube id. '' unless status is `found`. */
  videoId: string;
  /** The title as YouTube reported it at fetch time -- a snapshot, not a truth. */
  videoTitle: string;
  channel: string;
  /** Undefined for a live stream, which has no length. */
  durationSeconds?: number;
  /** Who chose it: 'youtube' for an automatic pick, later 'manual' for a pinned id. */
  source: string;
  /** What was actually queried, which is not always what the tags say. */
  searchArtist: string;
  searchTitle: string;
  fetchedAt: string;
}

/**
 * Whether a cached row is worth replacing with a fresh lookup.
 *
 * Every miss is retryable here, which is the difference from lyrics: LRCLIB can say a
 * track is instrumental and mean it, but YouTube can never say a song has no video --
 * only that our search and ranking did not find one. A `not_found` is as likely to be
 * an over-strict ranking rule as an absent video, so it never becomes permanent.
 */
export function isRetryable(video: TrackVideo | undefined): boolean {
  return video === undefined || video.status !== "found";
}
