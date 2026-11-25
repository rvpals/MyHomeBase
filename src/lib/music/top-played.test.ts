import { describe, expect, it } from "vitest";
import { listTopPlayedTracks } from "./music";
import type { MusicRepository } from "./ports";
import type { Track } from "./types";

// `listTopPlayedTracks` feeds the home screen's Media panel. The repository does the
// ranking (`ORDER BY play_count DESC`); what is tested here is the use-case's own
// rules: the cap, the unplayable-format skip, and a bad count.

function track(id: number, overrides: Partial<Track> = {}): Track {
  return {
    id,
    relativePath: `music/${id}.mp3`,
    fileName: `${id}.mp3`,
    title: `Track ${id}`,
    displayTitle: `Track ${id}`,
    artist: "Artist",
    album: "Album",
    albumArtist: "Artist",
    genre: "",
    extension: "mp3",
    mimeType: "audio/mpeg",
    fileSize: 1024,
    fileMtime: "2026-01-01 00:00:00",
    isStreamable: true,
    hasCueSheet: false,
    playCount: 10 - id,
    ...overrides,
  } as Track;
}

/** A repository whose most-played list is `tracks`, recording the limit it was asked for. */
function repoWith(tracks: Track[]): MusicRepository & { limits: number[] } {
  const limits: number[] = [];
  return {
    limits,
    listMostPlayed: ({ limit }: { limit: number; offset: number }) => {
      limits.push(limit);
      return { tracks: tracks.slice(0, limit), totalCount: tracks.length };
    },
  } as unknown as MusicRepository & { limits: number[] };
}

describe("listTopPlayedTracks", () => {
  it("returns the first `count` tracks in the repository's order", () => {
    const repo = repoWith([track(1), track(2), track(3), track(4)]);

    expect(listTopPlayedTracks(repo, 3).map((item) => item.id)).toEqual([1, 2, 3]);
  });

  it("skips formats the browser cannot play and fills from the next rows", () => {
    const repo = repoWith([
      track(1),
      track(2, { isStreamable: false, extension: "ape" }),
      track(3),
      track(4),
    ]);

    expect(listTopPlayedTracks(repo, 3).map((item) => item.id)).toEqual([1, 3, 4]);
  });

  it("returns fewer when fewer tracks have been played", () => {
    expect(listTopPlayedTracks(repoWith([track(1)]), 3)).toHaveLength(1);
    expect(listTopPlayedTracks(repoWith([]), 3)).toEqual([]);
  });

  it("returns nothing, without a query, for a count that is not a positive integer", () => {
    const repo = repoWith([track(1)]);

    expect(listTopPlayedTracks(repo, 0)).toEqual([]);
    expect(listTopPlayedTracks(repo, -2)).toEqual([]);
    expect(listTopPlayedTracks(repo, 1.5)).toEqual([]);
    expect(repo.limits).toEqual([]);
  });
});
