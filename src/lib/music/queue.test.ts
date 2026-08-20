import { describe, expect, it } from "vitest";
import {
  afterRemoving,
  currentIndex,
  currentItem,
  isRepeatMode,
  nextEntryId,
  previousEntryId,
  queueDurationSeconds,
  remainingDurationSeconds,
  shuffledEntryIds,
  type QueueItem,
  type QueueState,
} from "./queue";
import type { Track } from "./types";

// All pure, so tested directly with plain inputs. The advance rules are the part worth
// covering thoroughly: three repeat modes against "am I at the end" is where a player
// gets subtly wrong, and this logic used to live untestable inside a React callback.

function track(id: number, durationSeconds?: number): Track {
  return {
    id,
    relativePath: `music/track-${id}.mp3`,
    fileName: `track-${id}.mp3`,
    title: `Track ${id}`,
    displayTitle: `Track ${id}`,
    artist: "An Artist",
    album: "An Album",
    albumArtist: "An Artist",
    genre: "Rock",
    durationSeconds,
    extension: "mp3",
    mimeType: "audio/mpeg",
    fileSize: 1_000,
    fileMtime: "2026-01-01T00:00:00.000Z",
    isStreamable: true,
    hasCueSheet: false,
    playCount: 0,
  };
}

/**
 * A queue of `count` entries. Entry ids are deliberately NOT equal to track ids
 * (entry 101 holds track 1) so a test that confuses the two fails instead of passing
 * by coincidence.
 */
function queue(count: number, durationSeconds?: number): QueueItem[] {
  return Array.from({ length: count }, (_unused, index) => ({
    entry: { id: 101 + index, trackId: index + 1, position: index },
    track: track(index + 1, durationSeconds),
  }));
}

function state(overrides: Partial<QueueState> = {}): QueueState {
  return { repeatMode: "off", isShuffled: false, ...overrides };
}

/** An rng that returns 0, so Fisher-Yates swaps each item with index 0. */
const zeroRandom = () => 0;

describe("isRepeatMode", () => {
  it("accepts the three real modes", () => {
    expect(isRepeatMode("off")).toBe(true);
    expect(isRepeatMode("all")).toBe(true);
    expect(isRepeatMode("one")).toBe(true);
  });

  it("rejects anything else, including near-misses a typo would produce", () => {
    expect(isRepeatMode("ONE")).toBe(false);
    expect(isRepeatMode("loop")).toBe(false);
    expect(isRepeatMode("")).toBe(false);
  });
});

describe("currentIndex / currentItem", () => {
  it("finds the current entry", () => {
    const items = queue(3);
    expect(currentIndex(items, state({ currentEntryId: 102 }))).toBe(1);
    expect(currentItem(items, state({ currentEntryId: 102 }))?.track.id).toBe(2);
  });

  it("reports -1 when nothing is playing", () => {
    expect(currentIndex(queue(3), state())).toBe(-1);
    expect(currentItem(queue(3), state())).toBeUndefined();
  });

  it("reports -1 for a cursor pointing at an entry that no longer exists", () => {
    expect(currentIndex(queue(3), state({ currentEntryId: 999 }))).toBe(-1);
  });

  it("distinguishes two entries holding the same track", () => {
    // The bug this whole entry-id design exists to prevent: a track queued twice.
    const items: QueueItem[] = [
      { entry: { id: 1, trackId: 7, position: 0 }, track: track(7) },
      { entry: { id: 2, trackId: 7, position: 1 }, track: track(7) },
    ];
    expect(currentIndex(items, state({ currentEntryId: 2 }))).toBe(1);
  });
});

describe("nextEntryId", () => {
  it("advances to the following entry", () => {
    expect(nextEntryId(queue(3), state({ currentEntryId: 101 }))).toBe(102);
  });

  it("stops at the end with repeat off", () => {
    expect(nextEntryId(queue(3), state({ currentEntryId: 103 }))).toBeUndefined();
  });

  it("wraps to the top at the end with repeat all", () => {
    const current = state({ currentEntryId: 103, repeatMode: "all" });
    expect(nextEntryId(queue(3), current)).toBe(101);
  });

  it("replays the same entry when a track ends under repeat one", () => {
    const current = state({ currentEntryId: 102, repeatMode: "one" });
    expect(nextEntryId(queue(3), current)).toBe(102);
  });

  it("moves on when Next is PRESSED under repeat one", () => {
    // The judgement call: a looping track must still be skippable, or the button
    // appears broken.
    const current = state({ currentEntryId: 102, repeatMode: "one" });
    expect(nextEntryId(queue(3), current, { isManual: true })).toBe(103);
  });

  it("still stops at the end when Next is pressed under repeat one", () => {
    const current = state({ currentEntryId: 103, repeatMode: "one" });
    expect(nextEntryId(queue(3), current, { isManual: true })).toBeUndefined();
  });

  it("starts at the top when nothing is playing", () => {
    expect(nextEntryId(queue(3), state())).toBe(101);
  });

  it("starts at the top when the cursor points at a removed entry", () => {
    expect(nextEntryId(queue(3), state({ currentEntryId: 999 }))).toBe(101);
  });

  it("returns nothing for an empty queue", () => {
    expect(nextEntryId([], state())).toBeUndefined();
    expect(nextEntryId([], state({ repeatMode: "all" }))).toBeUndefined();
  });

  it("advances into the second copy of a repeated track rather than back to the first", () => {
    // The in-memory player got this wrong: findIndex on track id always found copy one.
    const items: QueueItem[] = [
      { entry: { id: 1, trackId: 7, position: 0 }, track: track(7) },
      { entry: { id: 2, trackId: 7, position: 1 }, track: track(7) },
      { entry: { id: 3, trackId: 8, position: 2 }, track: track(8) },
    ];
    expect(nextEntryId(items, state({ currentEntryId: 2 }))).toBe(3);
  });
});

describe("previousEntryId", () => {
  it("steps back one entry", () => {
    expect(previousEntryId(queue(3), state({ currentEntryId: 102 }))).toBe(101);
  });

  it("stays put at the top with repeat off", () => {
    // Not undefined: pressing Previous on the first track must not silence the music.
    expect(previousEntryId(queue(3), state({ currentEntryId: 101 }))).toBe(101);
  });

  it("wraps to the last entry at the top with repeat all", () => {
    const current = state({ currentEntryId: 101, repeatMode: "all" });
    expect(previousEntryId(queue(3), current)).toBe(103);
  });

  it("ignores repeat one, which only governs advancing", () => {
    const current = state({ currentEntryId: 102, repeatMode: "one" });
    expect(previousEntryId(queue(3), current)).toBe(101);
  });

  it("returns nothing for an empty queue", () => {
    expect(previousEntryId([], state())).toBeUndefined();
  });
});

describe("shuffledEntryIds", () => {
  it("keeps every entry exactly once", () => {
    const shuffled = shuffledEntryIds(queue(6), state({ currentEntryId: 101 }), zeroRandom);
    expect([...shuffled].sort((a, b) => a - b)).toEqual([101, 102, 103, 104, 105, 106]);
  });

  it("leaves the playing entry and everything before it in place", () => {
    const items = queue(6);
    const shuffled = shuffledEntryIds(items, state({ currentEntryId: 103 }), zeroRandom);
    // Entries 101-103 are history plus the current track; only 104-106 may move.
    expect(shuffled.slice(0, 3)).toEqual([101, 102, 103]);
    expect([...shuffled.slice(3)].sort((a, b) => a - b)).toEqual([104, 105, 106]);
  });

  it("shuffles the whole queue when nothing is playing", () => {
    const shuffled = shuffledEntryIds(queue(4), state(), zeroRandom);
    expect([...shuffled].sort((a, b) => a - b)).toEqual([101, 102, 103, 104]);
  });

  it("is a no-op on the last entry, which has nothing after it to reorder", () => {
    const shuffled = shuffledEntryIds(queue(3), state({ currentEntryId: 103 }), zeroRandom);
    expect(shuffled).toEqual([101, 102, 103]);
  });

  it("returns an empty order for an empty queue", () => {
    expect(shuffledEntryIds([], state(), zeroRandom)).toEqual([]);
  });
});

describe("afterRemoving", () => {
  it("drops the entry and leaves an unrelated cursor alone", () => {
    const result = afterRemoving(queue(3), state({ currentEntryId: 101 }), 103);
    expect(result.items.map((item) => item.entry.id)).toEqual([101, 102]);
    expect(result.currentEntryId).toBe(101);
  });

  it("moves the cursor to what followed when removing the playing entry", () => {
    const result = afterRemoving(queue(3), state({ currentEntryId: 102 }), 102);
    expect(result.items.map((item) => item.entry.id)).toEqual([101, 103]);
    expect(result.currentEntryId).toBe(103);
  });

  it("falls back to the new last entry when removing the playing tail", () => {
    const result = afterRemoving(queue(3), state({ currentEntryId: 103 }), 103);
    expect(result.currentEntryId).toBe(102);
  });

  it("leaves nothing current when the last remaining entry is removed", () => {
    const result = afterRemoving(queue(1), state({ currentEntryId: 101 }), 101);
    expect(result.items).toEqual([]);
    expect(result.currentEntryId).toBeUndefined();
  });

  it("removes only the addressed copy of a repeated track", () => {
    const items: QueueItem[] = [
      { entry: { id: 1, trackId: 7, position: 0 }, track: track(7) },
      { entry: { id: 2, trackId: 7, position: 1 }, track: track(7) },
    ];
    const result = afterRemoving(items, state({ currentEntryId: 1 }), 2);
    expect(result.items.map((item) => item.entry.id)).toEqual([1]);
    expect(result.currentEntryId).toBe(1);
  });

  it("is a no-op for an entry that is not in the queue", () => {
    const result = afterRemoving(queue(2), state({ currentEntryId: 101 }), 999);
    expect(result.items).toHaveLength(2);
    expect(result.currentEntryId).toBe(101);
  });
});

describe("queueDurationSeconds / remainingDurationSeconds", () => {
  it("totals the queue", () => {
    expect(queueDurationSeconds(queue(3, 200))).toBe(600);
  });

  it("counts an untagged duration as zero rather than failing", () => {
    expect(queueDurationSeconds(queue(2, undefined))).toBe(0);
  });

  it("counts only what follows the current entry as remaining", () => {
    const items = queue(4, 100);
    expect(remainingDurationSeconds(items, state({ currentEntryId: 102 }))).toBe(200);
  });

  it("counts the whole queue as remaining when nothing is playing", () => {
    expect(remainingDurationSeconds(queue(4, 100), state())).toBe(400);
  });

  it("reports nothing remaining on the last entry", () => {
    expect(remainingDurationSeconds(queue(3, 100), state({ currentEntryId: 103 }))).toBe(0);
  });

  it("totals an empty queue as zero", () => {
    expect(queueDurationSeconds([])).toBe(0);
  });
});
