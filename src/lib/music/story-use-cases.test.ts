import { describe, expect, it } from "vitest";
import { fetchTrackStory } from "./story-use-cases";
import type { MusicRepository, StoryClient } from "./ports";
import type { SongStory, StoryQuery } from "./story";
import type { Track } from "./types";

// Offline throughout: the StoryClient port is what makes that possible, and it is the
// reason the port exists.

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: 7,
    relativePath: "Billy Joel/52nd Street/03 Honesty.mp3",
    fileName: "03 Honesty.mp3",
    title: "Honesty",
    displayTitle: "Honesty",
    artist: "Billy Joel",
    album: "52nd Street",
    albumArtist: "Billy Joel",
    genre: "Rock",
    extension: "mp3",
    mimeType: "audio/mpeg",
    fileSize: 1024,
    fileMtime: "2026-01-01 00:00:00",
    isStreamable: true,
    hasCueSheet: false,
    ...overrides,
  } as Track;
}

/** A repository that knows about one track and nothing else. */
function repoWith(found: Track | undefined): MusicRepository {
  return { getTrack: () => found } as unknown as MusicRepository;
}

function clientReturning(story: SongStory): StoryClient & { calls: StoryQuery[] } {
  const calls: StoryQuery[] = [];
  return {
    calls,
    lookup: async (query) => {
      calls.push(query);
      return story;
    },
  };
}

const foundStory: SongStory = {
  status: "found",
  facts: ["Joel called it the most bulls--t song he ever wrote."],
  sourceUrl: "https://www.songfacts.com/facts/billy-joel/honesty",
  matchedTitle: "Honesty",
  matchedArtist: "Billy Joel",
};

describe("fetchTrackStory", () => {
  it("returns the story the client found, and searches on the track's tags", async () => {
    const storyClient = clientReturning(foundStory);
    const outcome = await fetchTrackStory({ musicRepo: repoWith(track()), storyClient }, 7);

    expect(outcome).toEqual({ kind: "found", story: foundStory });
    expect(storyClient.calls).toEqual([{ artist: "Billy Joel", title: "Honesty" }]);
  });

  it("reports a miss with a search URL the listener can open", async () => {
    // The miss carries a way forward on purpose: Songfacts' robots.txt disallows
    // /search, so when our slug guesses fail, handing the search to the human is the
    // only remaining move.
    const storyClient = clientReturning({ status: "not_found", facts: [], sourceUrl: "" });
    const outcome = await fetchTrackStory({ musicRepo: repoWith(track()), storyClient }, 7);

    expect(outcome).toEqual({
      kind: "not-found",
      searchUrl: "https://www.songfacts.com/search/songs/Billy%20Joel%20Honesty",
    });
  });

  it("reports a thrown lookup as failed, distinct from not-found", async () => {
    // "Songfacts is unreachable" must never be shown as "this song has no story".
    const storyClient: StoryClient = {
      lookup: async () => {
        throw new Error("network down");
      },
    };
    const outcome = await fetchTrackStory({ musicRepo: repoWith(track()), storyClient }, 7);

    expect(outcome).toEqual({ kind: "failed" });
  });

  it("does not call the service when no URL can be built", async () => {
    const storyClient = clientReturning(foundStory);
    const untaggable = track({ artist: "", title: "", fileName: "track01.mp3" });
    const outcome = await fetchTrackStory(
      { musicRepo: repoWith(untaggable), storyClient },
      7,
    );

    expect(outcome.kind).toBe("unsearchable");
    expect(storyClient.calls).toEqual([]);
  });

  it("reports a track that is no longer in the library", async () => {
    const storyClient = clientReturning(foundStory);
    const outcome = await fetchTrackStory(
      { musicRepo: repoWith(undefined), storyClient },
      999,
    );

    expect(outcome).toEqual({ kind: "no-such-track" });
    expect(storyClient.calls).toEqual([]);
  });

  it("writes nothing -- the story is viewed, not stored", async () => {
    // Guards the decision, not an implementation detail: there is no mus_track_story
    // table, so any save call here would be a crash in production.
    const storyClient = clientReturning(foundStory);
    const musicRepo = new Proxy(
      { getTrack: () => track() },
      {
        get(target, property) {
          if (property === "getTrack") return target.getTrack;
          throw new Error(`fetchTrackStory must not call musicRepo.${String(property)}`);
        },
      },
    ) as unknown as MusicRepository;

    await expect(fetchTrackStory({ musicRepo, storyClient }, 7)).resolves.toMatchObject({
      kind: "found",
    });
  });
});
