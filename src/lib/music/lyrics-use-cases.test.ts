import { describe, expect, it } from "vitest";
import { fetchTrackLyrics } from "./lyrics-use-cases";
import type { LyricsQuery, TrackLyrics } from "./lyrics";
import type { LyricsClient, LyricsLookupResult, MusicRepository } from "./ports";
import type { Track } from "./types";

// Tested against fakes, so no network and no database -- the point of the ports.

function fakeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 1,
    relativePath: "CHINESE/Beyond/AMANI.flac",
    fileName: "AMANI.flac",
    title: "AMANI",
    displayTitle: "AMANI",
    artist: "Beyond",
    album: "",
    albumArtist: "",
    genre: "",
    durationSeconds: 290,
    extension: "flac",
    mimeType: "audio/flac",
    fileSize: 1,
    fileMtime: "2026-01-01T00:00:00Z",
    isStreamable: true,
    hasCueSheet: false,
    playCount: 0,
    ...overrides,
  };
}

/** A repository that only implements what the lyrics use-case touches. */
function fakeRepo(track: Track | undefined, cached?: TrackLyrics) {
  const saved: Omit<TrackLyrics, "fetchedAt">[] = [];
  let current = cached;
  const repo = {
    getTrack: () => track,
    getTrackLyrics: () => current,
    saveTrackLyrics: (lyrics: Omit<TrackLyrics, "fetchedAt">) => {
      saved.push(lyrics);
      current = { ...lyrics, fetchedAt: "2026-08-18 00:00:00" };
    },
  } as unknown as MusicRepository;
  return { repo, saved };
}

function fakeClient(
  behaviour: LyricsLookupResult | (() => never),
): { client: LyricsClient; calls: LyricsQuery[] } {
  const calls: LyricsQuery[] = [];
  const client: LyricsClient = {
    lookup: async (query) => {
      calls.push(query);
      if (typeof behaviour === "function") return behaviour();
      return behaviour;
    },
  };
  return { client, calls };
}

describe("fetchTrackLyrics", () => {
  it("fetches and caches a hit", async () => {
    const { repo, saved } = fakeRepo(fakeTrack());
    const { client, calls } = fakeClient({ status: "found", lyrics: "Amani, nakupenda" });

    const outcome = await fetchTrackLyrics({ musicRepo: repo, lyricsClient: client }, 1);

    expect(outcome.kind).toBe("fetched");
    expect(calls[0]).toMatchObject({ artist: "Beyond", title: "AMANI" });
    expect(saved[0]).toMatchObject({ status: "found", lyrics: "Amani, nakupenda", source: "lrclib" });
  });

  it("serves a cached hit without calling the service again", async () => {
    const cached: TrackLyrics = {
      trackId: 1,
      status: "found",
      lyrics: "already here",
      source: "lrclib",
      searchArtist: "Beyond",
      searchTitle: "AMANI",
      fetchedAt: "2026-08-01 00:00:00",
    };
    const { repo, saved } = fakeRepo(fakeTrack(), cached);
    const { client, calls } = fakeClient({ status: "found", lyrics: "should not be used" });

    const outcome = await fetchTrackLyrics({ musicRepo: repo, lyricsClient: client }, 1);

    expect(outcome).toEqual({ kind: "cached", lyrics: cached });
    expect(calls).toHaveLength(0);
    expect(saved).toHaveLength(0);
  });

  it("never re-requests an instrumental", async () => {
    const cached: TrackLyrics = {
      trackId: 1,
      status: "instrumental",
      lyrics: "",
      source: "lrclib",
      searchArtist: "Beyond",
      searchTitle: "AMANI",
      fetchedAt: "2026-08-01 00:00:00",
    };
    const { repo } = fakeRepo(fakeTrack(), cached);
    const { client, calls } = fakeClient({ status: "found", lyrics: "x" });

    const outcome = await fetchTrackLyrics({ musicRepo: repo, lyricsClient: client }, 1);

    expect(outcome.kind).toBe("cached");
    expect(calls).toHaveLength(0);
  });

  it("retries a previous miss, since the service's database grows", async () => {
    const cached: TrackLyrics = {
      trackId: 1,
      status: "not_found",
      lyrics: "",
      source: "lrclib",
      searchArtist: "Beyond",
      searchTitle: "AMANI",
      fetchedAt: "2026-08-01 00:00:00",
    };
    const { repo, saved } = fakeRepo(fakeTrack(), cached);
    const { client, calls } = fakeClient({ status: "found", lyrics: "found this time" });

    await fetchTrackLyrics({ musicRepo: repo, lyricsClient: client }, 1);

    expect(calls).toHaveLength(1);
    expect(saved[0]).toMatchObject({ status: "found" });
  });

  it("records a request failure as retryable, not as 'no lyrics'", async () => {
    // The important distinction: an offline NAS must not be remembered as a miss.
    const { repo, saved } = fakeRepo(fakeTrack());
    const { client } = fakeClient(() => {
      throw new Error("network down");
    });

    const outcome = await fetchTrackLyrics({ musicRepo: repo, lyricsClient: client }, 1);

    expect(outcome.kind).toBe("fetched");
    expect(saved[0]).toMatchObject({ status: "failed", lyrics: "" });
  });

  it("stores an instrumental verdict as its own status", async () => {
    const { repo, saved } = fakeRepo(fakeTrack());
    const { client } = fakeClient({ status: "instrumental" });

    await fetchTrackLyrics({ musicRepo: repo, lyricsClient: client }, 1);

    expect(saved[0]).toMatchObject({ status: "instrumental", lyrics: "" });
  });

  it("refuses to overwrite hand-entered lyrics, even with force", async () => {
    const manual: TrackLyrics = {
      trackId: 1,
      status: "found",
      lyrics: "typed by hand",
      source: "manual",
      searchArtist: "",
      searchTitle: "",
      fetchedAt: "2026-08-01 00:00:00",
    };
    const { repo, saved } = fakeRepo(fakeTrack(), manual);
    const { client, calls } = fakeClient({ status: "found", lyrics: "from the service" });

    const outcome = await fetchTrackLyrics({ musicRepo: repo, lyricsClient: client }, 1, {
      force: true,
    });

    expect(outcome).toEqual({ kind: "cached", lyrics: manual });
    expect(calls).toHaveLength(0);
    expect(saved).toHaveLength(0);
  });

  it("re-fetches a hit when forced", async () => {
    const cached: TrackLyrics = {
      trackId: 1,
      status: "found",
      lyrics: "old words",
      source: "lrclib",
      searchArtist: "Beyond",
      searchTitle: "AMANI",
      fetchedAt: "2026-08-01 00:00:00",
    };
    const { repo, saved } = fakeRepo(fakeTrack(), cached);
    const { client, calls } = fakeClient({ status: "found", lyrics: "new words" });

    await fetchTrackLyrics({ musicRepo: repo, lyricsClient: client }, 1, { force: true });

    expect(calls).toHaveLength(1);
    expect(saved[0]).toMatchObject({ lyrics: "new words" });
  });

  it("reports an unsearchable track without calling the service", async () => {
    const { repo, saved } = fakeRepo(fakeTrack({ title: "", artist: "", fileName: ".mp3" }));
    const { client, calls } = fakeClient({ status: "found", lyrics: "x" });

    const outcome = await fetchTrackLyrics({ musicRepo: repo, lyricsClient: client }, 1);

    expect(outcome.kind).toBe("unsearchable");
    expect(calls).toHaveLength(0);
    expect(saved).toHaveLength(0);
  });

  it("reports a missing track", async () => {
    const { repo } = fakeRepo(undefined);
    const { client, calls } = fakeClient({ status: "found", lyrics: "x" });

    const outcome = await fetchTrackLyrics({ musicRepo: repo, lyricsClient: client }, 999);

    expect(outcome).toEqual({ kind: "no-such-track" });
    expect(calls).toHaveLength(0);
  });
});
