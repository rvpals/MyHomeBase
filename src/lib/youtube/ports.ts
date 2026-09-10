import type { VideoLookup, VideoQuery } from "./types";

/**
 * The one seam where YouTube is reached over the network.
 *
 * Implemented by `YouTubeVideoClient`. Kept an interface for the same reason
 * `StoryClient` is one: the use-case is then testable with a fake, and no test in this
 * repo ever makes a real request.
 */
export interface VideoClient {
  /**
   * Searches for one song and returns the best candidate.
   *
   * Resolves to a status rather than rejecting when nothing suitable is found:
   * YouTube having no good match is an answer, not a failure. Rejects only when the
   * request itself could not be made, so the caller can distinguish "could not reach
   * YouTube" from "no video for this song".
   */
  lookup(query: VideoQuery): Promise<VideoLookup>;
}
