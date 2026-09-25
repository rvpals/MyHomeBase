import { describe, expect, it } from "vitest";
import { fetchTrackLyrics } from "./lyrics-use-cases";
import type { LyricsQuery, TrackLyrics } from "./lyrics";
import type {
  AudioMetadataReader,
  LyricsClient,
  LyricsLookupResult,
  MusicRepository,
} from "./ports";
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

/**
 * A tag reader that answers with fixed words, and records what it was asked for.
 *
 * `read` is left unimplemented: the lyrics use-case only ever calls `readLyrics`,
 * and a fake that implements more than the thing under test touches would hide a
 * change in that.
 */
function fakeReader(embedded: string | undefined): {
  reader: AudioMetadataReader;
  paths: string[];
} {
  const paths: string[] = [];
  const reader = {
    readLyrics: async (relativePath: string) => {
      paths.push(relativePath);
      return embedded;
    },
  } as unknown as AudioMetadataReader;
  return { reader, paths };
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

  it("prefers the file's own tags and never reaches the service", async () => {
    const { repo, saved } = fakeRepo(fakeTrack());
    const { client, calls } = fakeClient({ status: "found", lyrics: "from the internet" });
    const { reader, paths } = fakeReader("Amani, nakupenda");

    const outcome = await fetchTrackLyrics(
      { musicRepo: repo, lyricsClient: client, metadataReader: reader },
      1,
    );

    expect(outcome.kind).toBe("fetched");
    expect(paths).toEqual(["CHINESE/Beyond/AMANI.flac"]);
    expect(calls).toHaveLength(0);
    expect(saved[0]).toMatchObject({
      status: "found",
      lyrics: "Amani, nakupenda",
      source: "embedded",
    });
  });

  it("falls through to the service when the file carries no lyrics", async () => {
    const { repo, saved } = fakeRepo(fakeTrack());
    const { client, calls } = fakeClient({ status: "found", lyrics: "from the internet" });
    const { reader } = fakeReader(undefined);

    await fetchTrackLyrics(
      { musicRepo: repo, lyricsClient: client, metadataReader: reader },
      1,
    );

    expect(calls).toHaveLength(1);
    expect(saved[0]).toMatchObject({ lyrics: "from the internet", source: "lrclib" });
  });

  it("goes straight to the service when forced, rather than re-reading the same tag", async () => {
    // "Try again" is pressed by someone who has already seen the embedded words and
    // wants the other source; handing back the same tag would look like a no-op.
    const cached: TrackLyrics = {
      trackId: 1,
      status: "found",
      lyrics: "the words in the file",
      source: "embedded",
      searchArtist: "Beyond",
      searchTitle: "AMANI",
      fetchedAt: "2026-08-01 00:00:00",
    };
    const { repo, saved } = fakeRepo(fakeTrack(), cached);
    const { client, calls } = fakeClient({ status: "found", lyrics: "from the internet" });
    const { reader, paths } = fakeReader("the words in the file");

    await fetchTrackLyrics(
      { musicRepo: repo, lyricsClient: client, metadataReader: reader },
      1,
      { force: true },
    );

    expect(paths).toHaveLength(0);
    expect(calls).toHaveLength(1);
    expect(saved[0]).toMatchObject({ lyrics: "from the internet", source: "lrclib" });
  });

  it("does not read tags for something already cached", async () => {
    const cached: TrackLyrics = {
      trackId: 1,
      status: "found",
      lyrics: "already here",
      source: "lrclib",
      searchArtist: "Beyond",
      searchTitle: "AMANI",
      fetchedAt: "2026-08-01 00:00:00",
    };
    const { repo } = fakeRepo(fakeTrack(), cached);
    const { client, calls } = fakeClient({ status: "found", lyrics: "x" });
    const { reader, paths } = fakeReader("the words in the file");

    const outcome = await fetchTrackLyrics(
      { musicRepo: repo, lyricsClient: client, metadataReader: reader },
      1,
    );

    expect(outcome.kind).toBe("cached");
    expect(paths).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("reads tags for a track whose previous online lookup missed", async () => {
    // The upgrade path for a library scanned before embedded lyrics shipped: a
    // `not_found` row is retryable, so the file's own words get picked up on the
    // next open with no backfill.
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
    const { client, calls } = fakeClient({ status: "not_found" });
    const { reader } = fakeReader("Amani, nakupenda");

    await fetchTrackLyrics(
      { musicRepo: repo, lyricsClient: client, metadataReader: reader },
      1,
    );

    expect(calls).toHaveLength(0);
    expect(saved[0]).toMatchObject({ status: "found", source: "embedded" });
  });

  it("uses embedded words even for a track with nothing to search for", async () => {
    // No title and no usable filename means LRCLIB could never be asked -- but the
    // file's own tag needs no search terms at all.
    const { repo, saved } = fakeRepo(fakeTrack({ title: "", artist: "", fileName: ".mp3" }));
    const { client, calls } = fakeClient({ status: "found", lyrics: "x" });
    const { reader } = fakeReader("the words in the file");

    const outcome = await fetchTrackLyrics(
      { musicRepo: repo, lyricsClient: client, metadataReader: reader },
      1,
    );

    expect(outcome.kind).toBe("fetched");
    expect(calls).toHaveLength(0);
    expect(saved[0]).toMatchObject({ lyrics: "the words in the file", source: "embedded" });
  });
});
