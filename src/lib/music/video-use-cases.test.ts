import { describe, expect, it } from "vitest";
import { fetchTrackVideo, readCachedVideo } from "./video-use-cases";
import type { MusicRepository } from "./ports";
import type { TrackVideo } from "./video";
import type { Track } from "./types";
import type { VideoClient, VideoLookup, VideoQuery } from "@/lib/youtube";

// Offline throughout: the VideoClient port is what makes that possible, and it is the
// reason the port exists. No test in this file touches youtube.com.

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
    durationSeconds: 227,
    extension: "mp3",
    mimeType: "audio/mpeg",
    fileSize: 1024,
    fileMtime: "2026-01-01 00:00:00",
    isStreamable: true,
    hasCueSheet: false,
    ...overrides,
  } as Track;
}

/** A repository over one track and an in-memory video row, recording every save. */
function repo(options: { found?: Track; cached?: TrackVideo } = {}) {
  const saves: Omit<TrackVideo, "fetchedAt">[] = [];
  let row = options.cached;

  const musicRepo = {
    getTrack: () => options.found,
    getTrackVideo: () => row,
    saveTrackVideo: (video: Omit<TrackVideo, "fetchedAt">) => {
      saves.push(video);
      row = { ...video, fetchedAt: "2026-09-09 12:00:00" };
    },
  } as unknown as MusicRepository;

  return { musicRepo, saves, current: () => row };
}

function clientReturning(lookup: VideoLookup): VideoClient & { calls: VideoQuery[] } {
  const calls: VideoQuery[] = [];
  return {
    calls,
    lookup: async (query) => {
      calls.push(query);
      return lookup;
    },
  };
}

function throwingClient(): VideoClient & { calls: VideoQuery[] } {
  const calls: VideoQuery[] = [];
  return {
    calls,
    lookup: async (query) => {
      calls.push(query);
      throw new Error("YouTube unreachable");
    },
  };
}

const SEARCH_URL = "https://www.youtube.com/results?search_query=Billy%20Joel%20Honesty";

const foundLookup: VideoLookup = {
  status: "found",
  video: {
    videoId: "SuFScoO4tb0",
    title: "Billy Joel - Honesty (Official Video)",
    channel: "billyjoelVEVO",
    durationSeconds: 227,
  },
  searchUrl: SEARCH_URL,
};

const cachedHit: TrackVideo = {
  trackId: 7,
  status: "found",
  videoId: "cached00001",
  videoTitle: "Billy Joel - Honesty",
  channel: "billyjoelVEVO",
  durationSeconds: 227,
  source: "youtube",
  searchArtist: "Billy Joel",
  searchTitle: "Honesty",
  fetchedAt: "2026-09-01 10:00:00",
};

describe("fetchTrackVideo", () => {
  it("finds a video and caches it, searching on the track's tags and length", async () => {
    const store = repo({ found: track() });
    const videoClient = clientReturning(foundLookup);

    const outcome = await fetchTrackVideo({ musicRepo: store.musicRepo, videoClient }, 7);

    expect(outcome.kind).toBe("found");
    expect(outcome).toMatchObject({ fromCache: false });
    // The duration is what rejects hour-long compilations, so it must be passed.
    expect(videoClient.calls).toEqual([
      { artist: "Billy Joel", title: "Honesty", durationSeconds: 227 },
    ]);
    expect(store.saves).toHaveLength(1);
    expect(store.saves[0]).toMatchObject({
      trackId: 7,
      status: "found",
      videoId: "SuFScoO4tb0",
      channel: "billyjoelVEVO",
      source: "youtube",
      searchArtist: "Billy Joel",
      searchTitle: "Honesty",
    });
  });

  it("serves a cached hit without touching the network", async () => {
    const store = repo({ found: track(), cached: cachedHit });
    const videoClient = clientReturning(foundLookup);

    const outcome = await fetchTrackVideo({ musicRepo: store.musicRepo, videoClient }, 7);

    expect(outcome).toMatchObject({ kind: "found", fromCache: true });
    expect(videoClient.calls).toEqual([]);
    expect(store.saves).toEqual([]);
  });

  it("bypasses a cached hit when forced, so a wrong pick can be replaced", async () => {
    const store = repo({ found: track(), cached: cachedHit });
    const videoClient = clientReturning(foundLookup);

    const outcome = await fetchTrackVideo({ musicRepo: store.musicRepo, videoClient }, 7, true);

    expect(outcome).toMatchObject({ kind: "found", fromCache: false });
    expect(videoClient.calls).toHaveLength(1);
    expect(store.current()?.videoId).toBe("SuFScoO4tb0");
  });

  it("retries a cached miss without being forced", async () => {
    // A not_found is as likely to be our ranking being strict as YouTube being empty,
    // so it must never become a permanent answer.
    const store = repo({
      found: track(),
      cached: { ...cachedHit, status: "not_found", videoId: "" },
    });
    const videoClient = clientReturning(foundLookup);

    const outcome = await fetchTrackVideo({ musicRepo: store.musicRepo, videoClient }, 7);

    expect(outcome.kind).toBe("found");
    expect(videoClient.calls).toHaveLength(1);
  });

  it("reports a miss with a search URL, and caches it so a second press does not rescrape", async () => {
    const store = repo({ found: track() });
    const videoClient = clientReturning({ status: "not_found", searchUrl: SEARCH_URL });

    const outcome = await fetchTrackVideo({ musicRepo: store.musicRepo, videoClient }, 7);

    expect(outcome).toEqual({ kind: "not-found", searchUrl: SEARCH_URL });
    expect(store.saves[0]).toMatchObject({ status: "not_found", videoId: "" });
  });

  it("reports a failure distinctly from a miss when YouTube cannot be reached", async () => {
    const store = repo({ found: track() });
    const videoClient = throwingClient();

    const outcome = await fetchTrackVideo({ musicRepo: store.musicRepo, videoClient }, 7);

    expect(outcome.kind).toBe("failed");
    // Recorded as failed, not not_found: a network blip must never be remembered as
    // "there is no video for this song".
    expect(store.saves[0]).toMatchObject({ status: "failed" });
  });

  it("refuses to search a track with no artist, without making a request", async () => {
    const store = repo({ found: track({ artist: "", fileName: "Honesty.mp3", title: "Honesty" }) });
    const videoClient = clientReturning(foundLookup);

    const outcome = await fetchTrackVideo({ musicRepo: store.musicRepo, videoClient }, 7);

    expect(outcome.kind).toBe("unsearchable");
    expect(videoClient.calls).toEqual([]);
    expect(store.saves).toEqual([]);
  });

  it("falls back to an 'Artist - Title.mp3' filename when the tags are empty", async () => {
    const store = repo({
      found: track({ artist: "", title: "", fileName: "Billy Joel - Honesty.mp3" }),
    });
    const videoClient = clientReturning(foundLookup);

    await fetchTrackVideo({ musicRepo: store.musicRepo, videoClient }, 7);

    expect(videoClient.calls[0]).toMatchObject({ artist: "Billy Joel", title: "Honesty" });
  });

  it("reports a missing track", async () => {
    const store = repo({ found: undefined });
    const videoClient = clientReturning(foundLookup);

    const outcome = await fetchTrackVideo({ musicRepo: store.musicRepo, videoClient }, 999);

    expect(outcome).toEqual({ kind: "no-such-track" });
    expect(videoClient.calls).toEqual([]);
  });

  it("omits the duration from the query when the file is untagged", async () => {
    const store = repo({ found: track({ durationSeconds: undefined }) });
    const videoClient = clientReturning(foundLookup);

    await fetchTrackVideo({ musicRepo: store.musicRepo, videoClient }, 7);

    expect(videoClient.calls[0].durationSeconds).toBeUndefined();
  });
});

describe("readCachedVideo", () => {
  it("returns nothing for a track never looked up", () => {
    const store = repo({ found: track() });
    expect(readCachedVideo({ musicRepo: store.musicRepo }, 7)).toBeUndefined();
  });

  it("returns a cached hit marked as cached", () => {
    const store = repo({ found: track(), cached: cachedHit });
    expect(readCachedVideo({ musicRepo: store.musicRepo }, 7)).toMatchObject({
      kind: "found",
      fromCache: true,
    });
  });

  it("returns a remembered miss, with a search URL built from what was asked", () => {
    const store = repo({
      found: track(),
      cached: { ...cachedHit, status: "not_found", videoId: "" },
    });
    expect(readCachedVideo({ musicRepo: store.musicRepo }, 7)).toEqual({
      kind: "not-found",
      searchUrl: SEARCH_URL,
    });
  });

  it("distinguishes a remembered failure from a remembered miss", () => {
    const store = repo({
      found: track(),
      cached: { ...cachedHit, status: "failed", videoId: "" },
    });
    expect(readCachedVideo({ musicRepo: store.musicRepo }, 7)).toMatchObject({ kind: "failed" });
  });
});
