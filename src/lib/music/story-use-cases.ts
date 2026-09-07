import { deriveStoryQuery, songfactsSearchUrl, type SongStory } from "./story";
import type { MusicRepository, StoryClient } from "./ports";

// The story use-case: what happens when a track starts playing.
//
// Orchestration only -- the search terms come from story.ts, the request from a
// StoryClient. Notably absent: any write. The story is **not stored**. It is fetched
// for viewing and held in the player's memory for as long as that track is up, which
// is why there is no `mus_track_story` table, no migration, and no `force` flag (there
// is no cache for a force to bypass).
//
// The repository still appears here, for reading the track only.

export interface FetchStoryDependencies {
  musicRepo: MusicRepository;
  storyClient: StoryClient;
}

export type FetchStoryOutcome =
  | { kind: "found"; story: SongStory }
  | { kind: "not-found"; searchUrl: string }
  | { kind: "failed" }
  | { kind: "unsearchable"; reason: string }
  | { kind: "no-such-track" };

/**
 * Looks up the story behind a track, fetching it fresh every time.
 *
 * The three unhappy outcomes are kept distinct because they need different words in
 * the player, and collapsing them would mislead:
 *
 *   - `unsearchable` -- we cannot even build a URL (no artist). Tagging the file fixes
 *     it, and no request is made.
 *   - `not-found`    -- the guessed URLs missed. Carries a Songfacts search URL,
 *     because a miss is often our slug guess being wrong rather than an absent story,
 *     and the listener can settle it in one click.
 *   - `failed`       -- Songfacts could not be reached. Nothing is wrong with the song.
 */
export async function fetchTrackStory(
  deps: FetchStoryDependencies,
  trackId: number,
): Promise<FetchStoryOutcome> {
  const track = deps.musicRepo.getTrack(trackId);
  if (track === undefined) return { kind: "no-such-track" };

  const query = deriveStoryQuery(track);
  if (query === undefined) {
    return {
      kind: "unsearchable",
      reason:
        "This track needs an artist and a title before its story can be looked up - Songfacts is browsed by name.",
    };
  }

  try {
    const story = await deps.storyClient.lookup(query);
    if (story.status === "found") return { kind: "found", story };
    return { kind: "not-found", searchUrl: songfactsSearchUrl(query) };
  } catch {
    return { kind: "failed" };
  }
}
