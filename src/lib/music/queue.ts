// The play queue: what is lined up, where in it you are, and how to advance.
//
// Every function here is pure -- it takes the queue and returns a decision or a new
// order. That is what lets the same rules run in the browser (the provider applies the
// result to its <audio> element), from the CLI, and in a test with no audio at all.
//
// The advance rules in particular were previously implied by a few lines inside
// MusicPlayerProvider, where they could not be tested and where a duplicated track
// silently misbehaved -- see migrations/0059.

import { shuffle, type RandomSource } from "@/lib/shared/random";
import type { Track } from "./types";

/** How the queue behaves when a track ends. */
export const REPEAT_MODES = ["off", "all", "one"] as const;

export type RepeatMode = (typeof REPEAT_MODES)[number];

export function isRepeatMode(value: string): value is RepeatMode {
  return (REPEAT_MODES as readonly string[]).includes(value);
}

/** Label and one-line meaning for each mode, shared by the UI and the CLI. */
export const REPEAT_MODE_INFO: Record<RepeatMode, { label: string; description: string }> = {
  off: { label: "No repeat", description: "Stop when the queue runs out." },
  all: { label: "Repeat all", description: "Start the queue again from the top." },
  one: { label: "Repeat one", description: "Keep replaying the current track." },
};

/**
 * One entry in the queue.
 *
 * `id` identifies the ENTRY, not the track -- the queue may hold the same track twice
 * (queue an album, then queue it again), and every operation here addresses entries so
 * that "the second copy of this song" is a place you can be. See migrations/0059.
 */
export interface QueueEntry {
  id: number;
  trackId: number;
  position: number;
}

/** A queue entry joined to the track it points at, which is what a view needs. */
export interface QueueItem {
  entry: QueueEntry;
  track: Track;
}

/** The queue's cursor and its two modes. One row in `mus_play_queue_state`. */
export interface QueueState {
  /** The entry being played, or undefined for a queue that is loaded but not started. */
  currentEntryId?: number;
  repeatMode: RepeatMode;
  isShuffled: boolean;
}

/** The whole queue as a view needs it: the items, in order, plus the state. */
export interface PlayQueue {
  items: QueueItem[];
  state: QueueState;
}

/** Where the cursor is in the list, or -1 when it is nowhere (empty or not started). */
export function currentIndex(items: readonly QueueItem[], state: QueueState): number {
  if (state.currentEntryId === undefined) return -1;
  return items.findIndex((item) => item.entry.id === state.currentEntryId);
}

/** The item being played, if any. */
export function currentItem(
  items: readonly QueueItem[],
  state: QueueState,
): QueueItem | undefined {
  const index = currentIndex(items, state);
  return index === -1 ? undefined : items[index];
}

/**
 * Which entry to play after this one, honouring the repeat mode.
 *
 * Returns the entry id to play, or `undefined` to stop. Separated from the player so the
 * rule is stated once and tested: three modes times "am I at the end" is six cases, and
 * the version that lived inside a `useCallback` covered them by accident at best.
 *
 * `isManual` distinguishes pressing Next from a track ending. Under "repeat one" they
 * must differ -- a track ending replays itself, but pressing Next while one song loops
 * and getting the same song again is the player ignoring you. This is the behaviour
 * every mainstream player has, and it is the one thing here that is a judgement call
 * rather than a consequence of the mode.
 */
export function nextEntryId(
  items: readonly QueueItem[],
  state: QueueState,
  options: { isManual?: boolean } = {},
): number | undefined {
  if (items.length === 0) return undefined;

  const index = currentIndex(items, state);
  // Nothing current (or a cursor pointing at an entry that has been removed): the
  // sensible next thing is the top of the queue rather than nothing at all.
  if (index === -1) return items[0]?.entry.id;

  if (state.repeatMode === "one" && options.isManual !== true) {
    return items[index]?.entry.id;
  }

  const following = items[index + 1];
  if (following !== undefined) return following.entry.id;

  // At the end of the queue.
  if (state.repeatMode === "all") return items[0]?.entry.id;
  return undefined;
}

/**
 * Which entry to play before this one.
 *
 * Always manual -- nothing steps backwards on its own -- so "repeat one" is not
 * consulted. Under "repeat all", going back from the first entry wraps to the last,
 * which is what makes the queue feel circular in both directions rather than only
 * forwards.
 */
export function previousEntryId(
  items: readonly QueueItem[],
  state: QueueState,
): number | undefined {
  if (items.length === 0) return undefined;

  const index = currentIndex(items, state);
  if (index === -1) return items[0]?.entry.id;

  const preceding = items[index - 1];
  if (preceding !== undefined) return preceding.entry.id;

  if (state.repeatMode === "all") return items[items.length - 1]?.entry.id;
  // At the top with no repeat: stay where you are rather than stopping. Pressing
  // Previous on the first track should not silence the music.
  return items[index]?.entry.id;
}

/**
 * The queue reordered, with the playing track left where it is.
 *
 * The currently-playing entry keeps its place and only what follows is shuffled.
 * Shuffling the whole list would either interrupt the song you are listening to or
 * leave it stranded in the middle of a list it is no longer at the head of -- both read
 * as a bug. Everything before the current entry keeps its place too, since it has
 * already been played and reordering history is meaningless.
 *
 * Returns entry ids in their new order, which is exactly what `reorderQueue` takes.
 */
export function shuffledEntryIds(
  items: readonly QueueItem[],
  state: QueueState,
  random: RandomSource,
): number[] {
  const index = currentIndex(items, state);
  // Nothing playing: the whole queue is fair game.
  if (index === -1) return shuffle(items, random).map((item) => item.entry.id);

  const played = items.slice(0, index + 1).map((item) => item.entry.id);
  const pending = shuffle(items.slice(index + 1), random).map((item) => item.entry.id);
  return [...played, ...pending];
}

/**
 * The queue with one entry taken out, and where the cursor should land.
 *
 * Removing the entry you are listening to is allowed, and the answer is "play what
 * followed it" -- the same place `next` would have gone, which is the least surprising
 * outcome. Removing anything else leaves the cursor alone.
 *
 * Returns the surviving items and the entry that should now be current, so a caller
 * makes one decision instead of removing and then guessing.
 */
export function afterRemoving(
  items: readonly QueueItem[],
  state: QueueState,
  entryId: number,
): { items: QueueItem[]; currentEntryId?: number } {
  const remaining = items.filter((item) => item.entry.id !== entryId);
  if (state.currentEntryId !== entryId) {
    return { items: remaining, currentEntryId: state.currentEntryId };
  }

  // The removed entry was the current one. Take the entry that followed it in the
  // ORIGINAL order; falling back to the new last entry covers removing the tail.
  const index = items.findIndex((item) => item.entry.id === entryId);
  const following = items[index + 1] ?? remaining[remaining.length - 1];
  return { items: remaining, currentEntryId: following?.entry.id };
}

/** Total running time of the queue in seconds. Untagged durations count as zero. */
export function queueDurationSeconds(items: readonly QueueItem[]): number {
  return items.reduce((total, item) => total + (item.track.durationSeconds ?? 0), 0);
}

/**
 * What is still to come, in seconds -- everything after the current entry.
 *
 * The current track counts as spent in full rather than pro-rated by playback position:
 * this is a summary in a list, not a countdown, and threading the live position through
 * would make it a value that changes every second.
 */
export function remainingDurationSeconds(
  items: readonly QueueItem[],
  state: QueueState,
): number {
  const index = currentIndex(items, state);
  return queueDurationSeconds(index === -1 ? items : items.slice(index + 1));
}
