// What a YouTube lookup deals in. No music vocabulary here on purpose: this library
// takes an artist and a title and hands back a video, which is a shape Journal or any
// other module could ask for later.

/** The artist and title a video lookup is built from. */
export interface VideoQuery {
  artist: string;
  title: string;
  /**
   * The real length of the recording, when the caller knows it. Used to reject
   * hour-long compilations and 10-hour loops, which is the single most effective
   * ranking rule -- see `scoreCandidate`. Omit when unknown; ranking simply skips
   * the duration test rather than guessing.
   */
  durationSeconds?: number;
}

/** One search result, after parsing and before ranking. */
export interface VideoCandidate {
  /** The 11-character YouTube id. */
  videoId: string;
  title: string;
  /** The uploading channel, e.g. `billyjoelVEVO`. */
  channel: string;
  /** Parsed from the `3:47` badge. Undefined for a live stream, which has no length. */
  durationSeconds?: number;
  /**
   * False when YouTube says the video may not be embedded. Such a video renders as a
   * grey "Watch on YouTube" box in an iframe, so these are dropped rather than shown.
   * Undefined when the search payload did not say, which is treated as "probably yes".
   */
  playableInEmbed?: boolean;
}

/**
 * What a lookup can come back as.
 *
 * Three outcomes, matching the lyrics table's retryable/not split:
 *   - `found`     -- `video` holds the pick.
 *   - `not_found` -- YouTube returned nothing we would stand behind. Retryable: the
 *                    catalogue grows, and our ranking may have been too strict.
 *   - `failed`    -- the request itself could not be made. Retryable, and distinct
 *                    from `not_found` so an offline NAS is never remembered as
 *                    "there is no video for this song".
 */
export type VideoStatus = "found" | "not_found" | "failed";

export interface VideoLookup {
  status: VideoStatus;
  /** The chosen video. Present only when status is `found`. */
  video?: VideoCandidate;
  /** Where to send a human when we would not pick for them. */
  searchUrl: string;
}
