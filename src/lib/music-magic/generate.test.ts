import { describe, expect, it } from "vitest";
import type { Track } from "@/lib/music";
import {
  describeGeneration,
  selectTracksForTarget,
  spaceOutTracks,
} from "./generate";
import { formatRunningTime } from "./types";

// The selection algorithm is the piece that has to be right, and it is pure, so it is
// tested directly with plain inputs rather than through a repository.

/**
 * A track with just the fields selection cares about.
 *
 * Duration and id are the only ones that matter to the algorithm; the rest exist because
 * `Track` requires them, and filling them here rather than casting keeps the test honest
 * about what the domain type actually is.
 */
function track(
  id: number,
  durationSeconds: number | undefined,
  artist = "An Artist",
): Track {
  return {
    id,
    relativePath: `music/${id}.mp3`,
    fileName: `${id}.mp3`,
    title: `Track ${id}`,
    displayTitle: `Track ${id}`,
    artist,
    album: "An Album",
    albumArtist: artist,
    genre: "Rock",
    durationSeconds,
    extension: "mp3",
    mimeType: "audio/mpeg",
    fileSize: 1024,
    fileMtime: "2026-01-01T00:00:00.000Z",
    isStreamable: true,
    hasCueSheet: false,
    playCount: 0,
  };
}

/** An rng that never shuffles: returns 0, so Fisher-Yates swaps each item with index 0. */
const zeroRandom = () => 0;

/**
 * A deterministic rng cycling a fixed sequence.
 *
 * A fake rather than a seeded PRNG library: the only property the tests need is
 * repeatability, and a cycled sequence gives that with nothing to install.
 */
function sequenceRandom(values: readonly number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index % values.length] as number;
    index += 1;
    return value;
  };
}

describe("selectTracksForTarget", () => {
  it("fills toward the target and reports the total", () => {
    const candidates = Array.from({ length: 20 }, (_, index) => track(index + 1, 300));
    const result = selectTracksForTarget(candidates, 1800, zeroRandom);

    // Six 5-minute tracks is exactly 30 minutes.
    expect(result.tracks).toHaveLength(6);
    expect(result.stats.totalSeconds).toBe(1800);
    expect(result.stats.deltaSeconds).toBe(0);
    expect(result.stats.candidateCount).toBe(20);
  });

  it("never repeats a track", () => {
    const candidates = Array.from({ length: 30 }, (_, index) => track(index + 1, 200));
    const result = selectTracksForTarget(candidates, 3000, sequenceRandom([0.2, 0.7, 0.4]));

    const ids = result.tracks.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("takes a final overshooting track when that lands closer to the target", () => {
    // 3 x 600s = 1800. Target 1900: adding a fourth overshoots by 500, stopping short
    // falls 100 short -- so it should stop. Target 2200 instead: overshoot 200 beats a
    // 400 shortfall, so it should take it.
    const candidates = Array.from({ length: 10 }, (_, index) => track(index + 1, 600));

    const stopsShort = selectTracksForTarget(candidates, 1900, zeroRandom);
    expect(stopsShort.stats.totalSeconds).toBe(1800);

    const overshoots = selectTracksForTarget(candidates, 2200, zeroRandom);
    expect(overshoots.stats.totalSeconds).toBe(2400);
    expect(overshoots.stats.deltaSeconds).toBe(200);
  });

  it("skips a track too long for the remaining gap and keeps looking", () => {
    // One 30-minute track first, then short ones. With a 10-minute target the long track
    // must be skipped -- and the short ones must still fill the time.
    const candidates = [track(1, 1800), track(2, 300), track(3, 300)];
    const result = selectTracksForTarget(candidates, 600, zeroRandom);

    expect(result.tracks.map((entry) => entry.id).sort()).toEqual([2, 3]);
    expect(result.stats.totalSeconds).toBe(600);
  });

  it("returns everything it has when the candidates run short of the target", () => {
    const candidates = [track(1, 300), track(2, 300)];
    const result = selectTracksForTarget(candidates, 7200, zeroRandom);

    expect(result.tracks).toHaveLength(2);
    expect(result.stats.totalSeconds).toBe(600);
    expect(result.stats.exhaustedCandidates).toBe(true);
    expect(result.stats.deltaSeconds).toBeLessThan(0);
  });

  it("returns nothing when there are no candidates", () => {
    const result = selectTracksForTarget([], 3600, zeroRandom);

    expect(result.tracks).toEqual([]);
    expect(result.stats.candidateCount).toBe(0);
    expect(result.stats.totalSeconds).toBe(0);
    // Not "exhausted": there was nothing to exhaust, and the UI words those two cases
    // differently.
    expect(result.stats.exhaustedCandidates).toBe(false);
  });

  it("takes a single track longer than the whole target", () => {
    // A 20-minute track against a 5-minute target: overshoot 900 vs shortfall 300, so it
    // is refused and the playlist comes back empty rather than running 4x too long.
    const result = selectTracksForTarget([track(1, 1200)], 300, zeroRandom);

    expect(result.tracks).toEqual([]);
    expect(result.stats.selectedCount).toBe(0);
    expect(result.stats.candidateCount).toBe(1);
  });

  it("refuses a zero or negative duration rather than looping forever", () => {
    // The port promises a real duration, but this is the function that would hang if that
    // promise were broken, so the guard is tested.
    const candidates = [track(1, 0), track(2, -60), track(3, 300)];
    const result = selectTracksForTarget(candidates, 600, zeroRandom);

    expect(result.tracks.map((entry) => entry.id)).toEqual([3]);
    expect(result.stats.totalSeconds).toBe(300);
  });

  it("treats an undefined duration as unusable", () => {
    const candidates = [track(1, undefined), track(2, 300)];
    const result = selectTracksForTarget(candidates, 600, zeroRandom);

    expect(result.tracks.map((entry) => entry.id)).toEqual([2]);
  });

  it("is deterministic for a given rng, and varies with a different one", () => {
    const candidates = Array.from({ length: 40 }, (_, index) => track(index + 1, 200));

    const first = selectTracksForTarget(candidates, 2000, sequenceRandom([0.13, 0.71, 0.42]));
    const second = selectTracksForTarget(candidates, 2000, sequenceRandom([0.13, 0.71, 0.42]));
    expect(first.tracks.map((entry) => entry.id)).toEqual(second.tracks.map((entry) => entry.id));

    const different = selectTracksForTarget(candidates, 2000, sequenceRandom([0.9, 0.05, 0.5]));
    // Same length (same durations), different membership or order -- that is the whole
    // point of the feature.
    expect(different.tracks.map((entry) => entry.id)).not.toEqual(
      first.tracks.map((entry) => entry.id),
    );
  });
});

describe("spaceOutTracks", () => {
  /** How many times the same artist appears back-to-back. */
  function adjacentRepeats(tracks: readonly Track[]): number {
    let count = 0;
    for (let index = 1; index < tracks.length; index += 1) {
      if (tracks[index]?.artist === tracks[index - 1]?.artist) count += 1;
    }
    return count;
  }

  it("is a permutation -- never adds, drops or duplicates a track", () => {
    const tracks = [
      track(1, 200, "A"),
      track(2, 200, "A"),
      track(3, 200, "B"),
      track(4, 200, "A"),
      track(5, 200, "C"),
    ];
    const spaced = spaceOutTracks(tracks);

    expect(spaced).toHaveLength(tracks.length);
    expect(spaced.map((entry) => entry.id).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it("breaks up a clump of one artist", () => {
    // Three A's in a row, with other artists available to interleave.
    const tracks = [
      track(1, 200, "A"),
      track(2, 200, "A"),
      track(3, 200, "A"),
      track(4, 200, "B"),
      track(5, 200, "C"),
      track(6, 200, "D"),
    ];

    expect(adjacentRepeats(tracks)).toBe(2);
    expect(adjacentRepeats(spaceOutTracks(tracks))).toBe(0);
  });

  it("does not modify the input", () => {
    const tracks = [track(1, 200, "A"), track(2, 200, "A"), track(3, 200, "B")];
    spaceOutTracks(tracks);
    expect(tracks.map((entry) => entry.id)).toEqual([1, 2, 3]);
  });

  it("keeps the order it was given when there is nothing to fix", () => {
    // Already alternating: spacing must not shuffle a good order for its own sake.
    const tracks = [track(1, 200, "A"), track(2, 200, "B"), track(3, 200, "A")];
    expect(spaceOutTracks(tracks).map((entry) => entry.id)).toEqual([1, 2, 3]);
  });

  it("still returns every track when they are all one artist", () => {
    // Adjacency is unavoidable here -- the look-ahead finds nothing and keeps the order,
    // rather than dropping tracks to satisfy the rule.
    const tracks = Array.from({ length: 5 }, (_, index) => track(index + 1, 200, "A"));
    const spaced = spaceOutTracks(tracks);

    expect(spaced).toHaveLength(5);
    expect(adjacentRepeats(spaced)).toBe(4);
  });

  it("does not treat untagged artists as a group to space apart", () => {
    // The untagged pile is large and unrelated in this library, so spacing it would be
    // spacing apart strangers -- the order is left alone.
    const tracks = Array.from({ length: 4 }, (_, index) => track(index + 1, 200, ""));
    expect(spaceOutTracks(tracks).map((entry) => entry.id)).toEqual([1, 2, 3, 4]);
  });

  it("matches artists case-insensitively, as the catalog groups them", () => {
    const tracks = [track(1, 200, "Beyond"), track(2, 200, "beyond"), track(3, 200, "Other")];
    const spaced = spaceOutTracks(tracks);
    expect(spaced.map((entry) => entry.artist)).toEqual(["Beyond", "Other", "beyond"]);
  });

  it("handles an empty list and a single track", () => {
    expect(spaceOutTracks([])).toEqual([]);
    expect(spaceOutTracks([track(1, 200, "A")]).map((entry) => entry.id)).toEqual([1]);
  });

  it("only looks a bounded distance ahead", () => {
    // With lookAhead 1, only the immediately-next track can be swapped in, so a long run
    // of A's followed by a B cannot be fully interleaved. This pins the bound rather than
    // letting it silently become a full re-sort by artist.
    const tracks = [
      track(1, 200, "A"),
      track(2, 200, "A"),
      track(3, 200, "A"),
      track(4, 200, "A"),
      track(5, 200, "B"),
    ];
    const spaced = spaceOutTracks(tracks, 1);
    expect(spaced).toHaveLength(5);
    expect(adjacentRepeats(spaced)).toBeGreaterThan(0);
  });
});

describe("selection with spacing", () => {
  it("spaces the generated playlist without changing its running time", () => {
    // 10 tracks each from two artists, 200s apiece; a 2000s target takes 10 of them.
    const candidates = [
      ...Array.from({ length: 10 }, (_, index) => track(index + 1, 200, "A")),
      ...Array.from({ length: 10 }, (_, index) => track(index + 11, 200, "B")),
    ];
    const result = selectTracksForTarget(candidates, 2000, sequenceRandom([0.1, 0.6, 0.3]));

    // The stats are built from the selected set, so spacing cannot have moved them.
    expect(result.stats.totalSeconds).toBe(2000);
    expect(result.stats.selectedCount).toBe(result.tracks.length);
    expect(new Set(result.tracks.map((entry) => entry.id)).size).toBe(result.tracks.length);
  });

  it("reduces clumping compared with the raw shuffle", () => {
    // A candidate pool dominated by one artist is where clumping shows up.
    const candidates = [
      ...Array.from({ length: 12 }, (_, index) => track(index + 1, 200, "Dominant")),
      ...Array.from({ length: 12 }, (_, index) => track(index + 13, 200, `Other ${index}`)),
    ];
    const result = selectTracksForTarget(candidates, 3000, sequenceRandom([0.37, 0.82, 0.11, 0.55]));

    let repeats = 0;
    for (let index = 1; index < result.tracks.length; index += 1) {
      if (result.tracks[index]?.artist === result.tracks[index - 1]?.artist) repeats += 1;
    }
    // Not asserting zero: a pool that is half one artist cannot always avoid adjacency.
    // Asserting it is not rampant, which is what the pass is for.
    expect(repeats).toBeLessThanOrEqual(2);
  });
});

describe("describeGeneration", () => {
  it("explains a set that matched nothing", () => {
    const result = selectTracksForTarget([], 3600, zeroRandom);
    expect(describeGeneration(result.stats)).toContain("Nothing in the library matches");
  });

  it("explains candidates that were all too long", () => {
    const result = selectTracksForTarget([track(1, 9000)], 300, zeroRandom);
    expect(describeGeneration(result.stats)).toContain("longer than the target");
  });

  it("says so when the library ran out rather than claiming success", () => {
    const result = selectTracksForTarget([track(1, 300)], 3600, zeroRandom);
    expect(describeGeneration(result.stats)).toContain("all of them");
  });

  it("reports an exact hit plainly", () => {
    const candidates = Array.from({ length: 5 }, (_, index) => track(index + 1, 600));
    const result = selectTracksForTarget(candidates, 1800, zeroRandom);
    expect(describeGeneration(result.stats)).toBe("3 tracks, right on the target.");
  });

  it("reports the drift and its direction", () => {
    const candidates = Array.from({ length: 10 }, (_, index) => track(index + 1, 600));
    const overshoots = selectTracksForTarget(candidates, 2200, zeroRandom);
    expect(describeGeneration(overshoots.stats)).toContain("over the target");
  });
});

describe("formatRunningTime", () => {
  it("shows minutes below an hour", () => {
    expect(formatRunningTime(1800)).toBe("30 min");
  });

  it("shows hours and zero-padded minutes above one", () => {
    expect(formatRunningTime(3900)).toBe("1 h 05 m");
    expect(formatRunningTime(7200)).toBe("2 h 00 m");
  });

  it("floors a negative or nonsense value at zero rather than printing it", () => {
    expect(formatRunningTime(-60)).toBe("0 min");
  });
});
