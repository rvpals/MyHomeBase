import { describe, expect, it } from "vitest";
import type { MusicRepository } from "./ports";
import type { QueueEntry, QueueState, RepeatMode } from "./queue";
import {
  advanceQueue,
  clearQueue,
  closeQueue,
  enqueueTracks,
  getPlayQueue,
  playQueueEntry,
  removeQueueEntry,
  reorderQueue,
  rewindQueue,
  setQueue,
  setRepeatMode,
  shuffleQueue,
} from "./queue-use-cases";
import type { Track } from "./types";

// Tested against a real in-memory fake rather than a stub returning canned values: the
// interesting behaviour is ordering and cursor movement across several writes, and a
// stub that cannot actually reorder proves nothing about it.

function fakeTrack(id: number, durationSeconds = 200): Track {
  return {
    id,
    relativePath: `CHINESE/Beyond/track-${id}.flac`,
    fileName: `track-${id}.flac`,
    title: `Track ${id}`,
    displayTitle: `Track ${id}`,
    artist: "Beyond",
    album: "",
    albumArtist: "",
    genre: "",
    durationSeconds,
    extension: "flac",
    mimeType: "audio/flac",
    fileSize: 1,
    fileMtime: "2026-01-01T00:00:00Z",
    isStreamable: true,
    hasCueSheet: false,
    playCount: 0,
    ...{},
  };
}

/**
 * An in-memory queue store implementing the port's queue half.
 *
 * Entry ids start at 101 so a test that mixes up entry ids and track ids fails loudly
 * rather than passing by coincidence.
 */
function fakeRepo(options: { missingTrackIds?: readonly number[] } = {}) {
  let entries: QueueEntry[] = [];
  let nextId = 101;
  let state: QueueState = { repeatMode: "off", isShuffled: false };
  const missing = new Set(options.missingTrackIds ?? []);

  const repo = {
    listQueueEntries: () =>
      [...entries]
        .sort((left, right) => left.position - right.position || left.id - right.id)
        // A track deleted by a rescan is omitted, as the port promises.
        .filter((entry) => !missing.has(entry.trackId))
        .map((entry) => ({ entry, track: fakeTrack(entry.trackId) })),

    getQueueState: () => state,

    replaceQueue: (trackIds: readonly number[], currentIndex?: number) => {
      entries = trackIds.map((trackId, index) => ({
        id: nextId++,
        trackId,
        position: index,
      }));
      const target = currentIndex === undefined ? undefined : entries[currentIndex];
      state = { ...state, currentEntryId: target?.id };
      return entries.map((entry) => entry.id);
    },

    appendToQueue: (trackIds: readonly number[]) => {
      const start = entries.reduce((max, entry) => Math.max(max, entry.position), -1) + 1;
      const added = trackIds.map((trackId, index) => ({
        id: nextId++,
        trackId,
        position: start + index,
      }));
      entries = [...entries, ...added];
      return added.map((entry) => entry.id);
    },

    removeQueueEntry: (entryId: number) => {
      entries = entries.filter((entry) => entry.id !== entryId);
    },

    clearQueue: () => {
      entries = [];
    },

    reorderQueue: (orderedEntryIds: readonly number[]) => {
      entries = entries.map((entry) => {
        const position = orderedEntryIds.indexOf(entry.id);
        return position === -1 ? entry : { ...entry, position };
      });
    },

    saveQueueState: (patch: {
      currentEntryId?: number | null;
      repeatMode?: RepeatMode;
      isShuffled?: boolean;
    }) => {
      state = {
        // `null` clears; `undefined` means "leave alone" -- the distinction the port draws.
        currentEntryId:
          patch.currentEntryId === undefined
            ? state.currentEntryId
            : (patch.currentEntryId ?? undefined),
        repeatMode: patch.repeatMode ?? state.repeatMode,
        isShuffled: patch.isShuffled ?? state.isShuffled,
      };
    },
  } as unknown as MusicRepository;

  return { musicRepo: repo, entryIds: () => entries.map((entry) => entry.id) };
}

/** An rng returning 0, so Fisher-Yates is deterministic. */
const zeroRandom = () => 0;

function trackIdsOf(queue: { items: { track: Track }[] }): number[] {
  return queue.items.map((item) => item.track.id);
}

describe("setQueue", () => {
  it("replaces the queue and starts on the chosen index", () => {
    const deps = fakeRepo();
    const queue = setQueue({ trackIds: [7, 8, 9], startIndex: 1 }, deps);

    expect(trackIdsOf(queue)).toEqual([7, 8, 9]);
    expect(queue.state.currentEntryId).toBe(queue.items[1]?.entry.id);
  });

  it("starts at the top when no index is given", () => {
    const deps = fakeRepo();
    const queue = setQueue({ trackIds: [7, 8] }, deps);
    expect(queue.state.currentEntryId).toBe(queue.items[0]?.entry.id);
  });

  it("discards the previous queue rather than appending to it", () => {
    const deps = fakeRepo();
    setQueue({ trackIds: [1, 2, 3] }, deps);
    const queue = setQueue({ trackIds: [4, 5] }, deps);
    expect(trackIdsOf(queue)).toEqual([4, 5]);
  });

  it("clears the shuffled flag, since the new order is the caller's", () => {
    const deps = fakeRepo();
    setQueue({ trackIds: [1, 2, 3, 4] }, deps);
    shuffleQueue({ ...deps, random: zeroRandom });
    const queue = setQueue({ trackIds: [5, 6] }, deps);
    expect(queue.state.isShuffled).toBe(false);
  });

  it("keeps both copies of a track queued twice", () => {
    const deps = fakeRepo();
    const queue = setQueue({ trackIds: [7, 7] }, deps);
    expect(trackIdsOf(queue)).toEqual([7, 7]);
    expect(queue.items[0]?.entry.id).not.toBe(queue.items[1]?.entry.id);
  });
});

describe("enqueueTracks", () => {
  it("appends to the end without moving the cursor", () => {
    const deps = fakeRepo();
    const before = setQueue({ trackIds: [1, 2] }, deps);
    const after = enqueueTracks({ trackIds: [3] }, deps);

    expect(trackIdsOf(after)).toEqual([1, 2, 3]);
    expect(after.state.currentEntryId).toBe(before.state.currentEntryId);
  });

  it("appends into an empty queue without starting playback", () => {
    const deps = fakeRepo();
    const queue = enqueueTracks({ trackIds: [1] }, deps);
    expect(trackIdsOf(queue)).toEqual([1]);
    expect(queue.state.currentEntryId).toBeUndefined();
  });
});

describe("playQueueEntry", () => {
  it("moves the cursor to the chosen entry", () => {
    const deps = fakeRepo();
    const queue = setQueue({ trackIds: [1, 2, 3] }, deps);
    const target = queue.items[2]?.entry.id as number;

    expect(playQueueEntry({ entryId: target }, deps).state.currentEntryId).toBe(target);
  });

  it("ignores an entry that is not queued rather than clearing the cursor", () => {
    const deps = fakeRepo();
    const queue = setQueue({ trackIds: [1, 2] }, deps);
    const result = playQueueEntry({ entryId: 9_999 }, deps);
    expect(result.state.currentEntryId).toBe(queue.state.currentEntryId);
  });
});

describe("advanceQueue", () => {
  it("moves to the next entry and reports what plays", () => {
    const deps = fakeRepo();
    setQueue({ trackIds: [1, 2, 3] }, deps);
    const result = advanceQueue({}, deps);
    expect(result.playing?.track.id).toBe(2);
    expect(result.queue.state.currentEntryId).toBe(result.playing?.entry.id);
  });

  it("reports nothing to play at the end with repeat off", () => {
    const deps = fakeRepo();
    setQueue({ trackIds: [1, 2], startIndex: 1 }, deps);
    const result = advanceQueue({}, deps);
    expect(result.playing).toBeUndefined();
  });

  it("leaves the cursor on the last track when the queue runs out", () => {
    // So the screen still shows what just finished, and play restarts it.
    const deps = fakeRepo();
    const queue = setQueue({ trackIds: [1, 2], startIndex: 1 }, deps);
    const result = advanceQueue({}, deps);
    expect(result.queue.state.currentEntryId).toBe(queue.items[1]?.entry.id);
  });

  it("wraps to the top under repeat all", () => {
    const deps = fakeRepo();
    const queue = setQueue({ trackIds: [1, 2], startIndex: 1 }, deps);
    setRepeatMode({ repeatMode: "all" }, deps);
    const result = advanceQueue({}, deps);
    expect(result.playing?.entry.id).toBe(queue.items[0]?.entry.id);
  });

  it("replays the same track when one ends under repeat one", () => {
    const deps = fakeRepo();
    setQueue({ trackIds: [1, 2] }, deps);
    setRepeatMode({ repeatMode: "one" }, deps);
    expect(advanceQueue({}, deps).playing?.track.id).toBe(1);
  });

  it("skips onward when Next is pressed under repeat one", () => {
    const deps = fakeRepo();
    setQueue({ trackIds: [1, 2] }, deps);
    setRepeatMode({ repeatMode: "one" }, deps);
    expect(advanceQueue({ isManual: true }, deps).playing?.track.id).toBe(2);
  });

  it("starts at the top when nothing was playing", () => {
    const deps = fakeRepo();
    enqueueTracks({ trackIds: [4, 5] }, deps);
    expect(advanceQueue({}, deps).playing?.track.id).toBe(4);
  });

  it("reports nothing for an empty queue", () => {
    const deps = fakeRepo();
    const result = advanceQueue({}, deps);
    expect(result.playing).toBeUndefined();
    expect(result.queue.items).toEqual([]);
  });
});

describe("rewindQueue", () => {
  it("steps back one entry", () => {
    const deps = fakeRepo();
    setQueue({ trackIds: [1, 2, 3], startIndex: 2 }, deps);
    expect(rewindQueue(deps).playing?.track.id).toBe(2);
  });

  it("stays on the first track rather than stopping", () => {
    const deps = fakeRepo();
    setQueue({ trackIds: [1, 2] }, deps);
    expect(rewindQueue(deps).playing?.track.id).toBe(1);
  });

  it("wraps to the end under repeat all", () => {
    const deps = fakeRepo();
    setQueue({ trackIds: [1, 2, 3] }, deps);
    setRepeatMode({ repeatMode: "all" }, deps);
    expect(rewindQueue(deps).playing?.track.id).toBe(3);
  });

  it("reports nothing for an empty queue", () => {
    expect(rewindQueue(fakeRepo()).playing).toBeUndefined();
  });
});

describe("shuffleQueue", () => {
  it("keeps every track and marks the queue shuffled", () => {
    const deps = { ...fakeRepo(), random: zeroRandom };
    setQueue({ trackIds: [1, 2, 3, 4, 5] }, deps);
    const queue = shuffleQueue(deps);

    expect([...trackIdsOf(queue)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(queue.state.isShuffled).toBe(true);
  });

  it("leaves the playing track where it is", () => {
    const deps = { ...fakeRepo(), random: zeroRandom };
    setQueue({ trackIds: [1, 2, 3, 4, 5], startIndex: 1 }, deps);
    const queue = shuffleQueue(deps);

    // Track 1 already played and track 2 is playing: both hold their place.
    expect(trackIdsOf(queue).slice(0, 2)).toEqual([1, 2]);
    expect(queue.state.currentEntryId).toBe(queue.items[1]?.entry.id);
  });

  it("does nothing to an empty queue and does not claim to have shuffled it", () => {
    const deps = { ...fakeRepo(), random: zeroRandom };
    const queue = shuffleQueue(deps);
    expect(queue.items).toEqual([]);
    expect(queue.state.isShuffled).toBe(false);
  });
});

describe("removeQueueEntry", () => {
  it("takes an entry out and leaves an unrelated cursor alone", () => {
    const deps = fakeRepo();
    const before = setQueue({ trackIds: [1, 2, 3] }, deps);
    const after = removeQueueEntry({ entryId: before.items[2]?.entry.id as number }, deps);

    expect(trackIdsOf(after)).toEqual([1, 2]);
    expect(after.state.currentEntryId).toBe(before.state.currentEntryId);
  });

  it("moves the cursor onward when the playing entry is removed", () => {
    const deps = fakeRepo();
    const before = setQueue({ trackIds: [1, 2, 3], startIndex: 1 }, deps);
    const after = removeQueueEntry({ entryId: before.items[1]?.entry.id as number }, deps);

    expect(trackIdsOf(after)).toEqual([1, 3]);
    expect(after.state.currentEntryId).toBe(before.items[2]?.entry.id);
  });

  it("clears the cursor when the last entry is removed", () => {
    const deps = fakeRepo();
    const before = setQueue({ trackIds: [1] }, deps);
    const after = removeQueueEntry({ entryId: before.items[0]?.entry.id as number }, deps);

    expect(after.items).toEqual([]);
    expect(after.state.currentEntryId).toBeUndefined();
  });

  it("removes only the addressed copy of a repeated track", () => {
    const deps = fakeRepo();
    const before = setQueue({ trackIds: [7, 7] }, deps);
    const after = removeQueueEntry({ entryId: before.items[1]?.entry.id as number }, deps);
    expect(trackIdsOf(after)).toEqual([7]);
  });
});

describe("clearQueue", () => {
  it("empties the queue and resets the cursor and the flag", () => {
    const deps = { ...fakeRepo(), random: zeroRandom };
    setQueue({ trackIds: [1, 2, 3] }, deps);
    shuffleQueue(deps);
    const queue = clearQueue(deps);

    expect(queue.items).toEqual([]);
    expect(queue.state.currentEntryId).toBeUndefined();
    expect(queue.state.isShuffled).toBe(false);
  });

  it("keeps the repeat mode, which is a preference rather than queue content", () => {
    const deps = fakeRepo();
    setRepeatMode({ repeatMode: "all" }, deps);
    expect(clearQueue(deps).state.repeatMode).toBe("all");
  });
});

describe("closeQueue", () => {
  it("clears the cursor but keeps every entry", () => {
    const deps = fakeRepo();
    setQueue({ trackIds: [1, 2, 3], startIndex: 1 }, deps);
    const queue = closeQueue(deps);

    // The whole point: the bar hides, the 3-track queue survives.
    expect(trackIdsOf(queue)).toEqual([1, 2, 3]);
    expect(queue.state.currentEntryId).toBeUndefined();
  });

  it("leaves the shuffled flag alone, because the rows are still shuffled", () => {
    const deps = { ...fakeRepo(), random: zeroRandom };
    setQueue({ trackIds: [1, 2, 3] }, deps);
    shuffleQueue(deps);

    expect(closeQueue(deps).state.isShuffled).toBe(true);
  });

  it("is a no-op on a queue that was already closed", () => {
    const deps = fakeRepo();
    setQueue({ trackIds: [1, 2] }, deps);
    closeQueue(deps);
    const queue = closeQueue(deps);

    expect(trackIdsOf(queue)).toEqual([1, 2]);
    expect(queue.state.currentEntryId).toBeUndefined();
  });

  it("keeps the repeat mode, which is a preference rather than queue content", () => {
    const deps = fakeRepo();
    setQueue({ trackIds: [1] }, deps);
    setRepeatMode({ repeatMode: "all" }, deps);

    expect(closeQueue(deps).state.repeatMode).toBe("all");
  });
});

describe("setRepeatMode", () => {
  it("stores the mode", () => {
    const deps = fakeRepo();
    expect(setRepeatMode({ repeatMode: "one" }, deps).state.repeatMode).toBe("one");
    expect(setRepeatMode({ repeatMode: "off" }, deps).state.repeatMode).toBe("off");
  });
});

describe("reorderQueue", () => {
  it("applies the given order", () => {
    const deps = fakeRepo();
    const before = setQueue({ trackIds: [1, 2, 3] }, deps);
    const ids = before.items.map((item) => item.entry.id);
    const after = reorderQueue({ orderedEntryIds: [ids[2], ids[0], ids[1]] as number[] }, deps);

    expect(trackIdsOf(after)).toEqual([3, 1, 2]);
  });

  it("does not mark a hand reorder as shuffled", () => {
    const deps = { ...fakeRepo(), random: zeroRandom };
    const before = setQueue({ trackIds: [1, 2, 3] }, deps);
    shuffleQueue(deps);
    const ids = before.items.map((item) => item.entry.id);
    const after = reorderQueue({ orderedEntryIds: ids }, deps);

    expect(after.state.isShuffled).toBe(false);
  });
});

describe("getPlayQueue", () => {
  it("returns an empty queue rather than failing when nothing is queued", () => {
    const queue = getPlayQueue(fakeRepo());
    expect(queue.items).toEqual([]);
    expect(queue.state.repeatMode).toBe("off");
  });

  it("omits an entry whose track a rescan has deleted", () => {
    const deps = fakeRepo({ missingTrackIds: [2] });
    setQueue({ trackIds: [1, 2, 3] }, deps);
    expect(trackIdsOf(getPlayQueue(deps))).toEqual([1, 3]);
  });
});
