// The queue's use-cases: read it, change it, decide what plays next.
//
// Each one takes data plus a repository port and returns data, so the same call serves
// the player UI, the Queue screen and the CLI. The decisions themselves live in
// queue.ts as pure functions; these compose them with storage.
//
// Every mutation returns the resulting PlayQueue rather than void. That is deliberate:
// the caller is almost always a screen that must now render the new state, and returning
// it saves a second round trip and removes the window where the UI and the database
// disagree.

import type { RandomSource } from "@/lib/shared/random";
import type { MusicRepository } from "./ports";
import {
  afterRemoving,
  nextEntryId,
  previousEntryId,
  shuffledEntryIds,
  type PlayQueue,
  type QueueItem,
  type RepeatMode,
} from "./queue";

/** What the queue use-cases need. A single port -- the queue is all one table pair. */
export interface QueueDependencies {
  musicRepo: MusicRepository;
  /** Injected so a shuffle is deterministic in a test. Defaults to `Math.random`. */
  random?: RandomSource;
}

function readQueue(deps: QueueDependencies): PlayQueue {
  const items = deps.musicRepo.listQueueEntries();
  const state = deps.musicRepo.getQueueState();
  return { items, state };
}

/** The queue as a screen needs it: items in order, plus the cursor and modes. */
export function getPlayQueue(deps: QueueDependencies): PlayQueue {
  return readQueue(deps);
}

/**
 * Replaces the queue and returns it, with the cursor on `startIndex`.
 *
 * This is what clicking a track in a list does: the visible list becomes the queue, and
 * the clicked row becomes current. Replacing rather than appending matches what the
 * in-memory player did, and is what a listener expects from clicking a song in a folder.
 *
 * A replace clears the shuffled flag -- the new order is whatever the caller passed, so
 * describing it as shuffled would be a lie.
 */
export function setQueue(
  input: { trackIds: readonly number[]; startIndex?: number },
  deps: QueueDependencies,
): PlayQueue {
  const startIndex = input.startIndex ?? 0;
  deps.musicRepo.replaceQueue(input.trackIds, startIndex);
  deps.musicRepo.saveQueueState({ isShuffled: false });
  return readQueue(deps);
}

/** Appends tracks to the end of the queue, leaving what is playing alone. */
export function enqueueTracks(
  input: { trackIds: readonly number[] },
  deps: QueueDependencies,
): PlayQueue {
  deps.musicRepo.appendToQueue(input.trackIds);
  return readQueue(deps);
}

/**
 * Moves the cursor to a specific entry -- clicking a row in the Queue screen.
 *
 * An entry that is not in the queue is ignored rather than clearing the cursor: the
 * likeliest cause is a stale screen naming an entry someone else just removed, and
 * silently stopping the music is the worst available response to that.
 */
export function playQueueEntry(
  input: { entryId: number },
  deps: QueueDependencies,
): PlayQueue {
  const queue = readQueue(deps);
  const exists = queue.items.some((item) => item.entry.id === input.entryId);
  if (!exists) return queue;

  deps.musicRepo.saveQueueState({ currentEntryId: input.entryId });
  return readQueue(deps);
}

/**
 * Advances the cursor and reports what should now play.
 *
 * Returns the queue plus the item to play, or `undefined` for "stop" -- the end of a
 * queue with repeat off. `isManual` separates pressing Next from a track ending; see
 * `nextEntryId`.
 */
export function advanceQueue(
  input: { isManual?: boolean },
  deps: QueueDependencies,
): { queue: PlayQueue; playing?: QueueItem } {
  const queue = readQueue(deps);
  const targetId = nextEntryId(queue.items, queue.state, { isManual: input.isManual });

  if (targetId === undefined) {
    // The queue has run out. The cursor is left where it is rather than cleared, so the
    // screen still shows the last track as current and pressing play restarts it.
    return { queue };
  }

  deps.musicRepo.saveQueueState({ currentEntryId: targetId });
  return {
    queue: { items: queue.items, state: { ...queue.state, currentEntryId: targetId } },
    playing: queue.items.find((item) => item.entry.id === targetId),
  };
}

/** Steps the cursor back one entry. Always manual, so repeat-one does not apply. */
export function rewindQueue(deps: QueueDependencies): {
  queue: PlayQueue;
  playing?: QueueItem;
} {
  const queue = readQueue(deps);
  const targetId = previousEntryId(queue.items, queue.state);
  if (targetId === undefined) return { queue };

  deps.musicRepo.saveQueueState({ currentEntryId: targetId });
  return {
    queue: { items: queue.items, state: { ...queue.state, currentEntryId: targetId } },
    playing: queue.items.find((item) => item.entry.id === targetId),
  };
}

/**
 * Shuffles what is still to come and marks the queue shuffled.
 *
 * The playing track stays where it is -- see `shuffledEntryIds`. The flag is stored
 * because after the rewrite nothing in the rows can reveal that it happened.
 */
export function shuffleQueue(deps: QueueDependencies): PlayQueue {
  const queue = readQueue(deps);
  if (queue.items.length === 0) return queue;

  const order = shuffledEntryIds(queue.items, queue.state, deps.random ?? Math.random);
  deps.musicRepo.reorderQueue(order);
  deps.musicRepo.saveQueueState({ isShuffled: true });
  return readQueue(deps);
}

/**
 * Removes one entry, moving the cursor if it was the one playing.
 *
 * Both writes happen because a removal can change two things at once, and the pure
 * `afterRemoving` decides the second so this function does not have to guess.
 */
export function removeQueueEntry(
  input: { entryId: number },
  deps: QueueDependencies,
): PlayQueue {
  const queue = readQueue(deps);
  const outcome = afterRemoving(queue.items, queue.state, input.entryId);

  deps.musicRepo.removeQueueEntry(input.entryId);
  if (outcome.currentEntryId !== queue.state.currentEntryId) {
    // `?? null` rather than leaving it undefined: removing the last entry must actually
    // clear the cursor, and `undefined` means "leave this field alone" to the port.
    deps.musicRepo.saveQueueState({ currentEntryId: outcome.currentEntryId ?? null });
  }
  return readQueue(deps);
}

/** Empties the queue and clears the cursor and the shuffled flag. */
export function clearQueue(deps: QueueDependencies): PlayQueue {
  deps.musicRepo.clearQueue();
  deps.musicRepo.saveQueueState({ currentEntryId: null, isShuffled: false });
  return readQueue(deps);
}

/** Sets how the queue advances. */
export function setRepeatMode(
  input: { repeatMode: RepeatMode },
  deps: QueueDependencies,
): PlayQueue {
  deps.musicRepo.saveQueueState({ repeatMode: input.repeatMode });
  return readQueue(deps);
}

/** Reorders the queue wholesale — the drag-and-drop path, and what shuffle uses. */
export function reorderQueue(
  input: { orderedEntryIds: readonly number[] },
  deps: QueueDependencies,
): PlayQueue {
  deps.musicRepo.reorderQueue(input.orderedEntryIds);
  // A hand reorder is not a shuffle: the listener chose this order, so the flag that
  // says "the machine scrambled this" would be misleading.
  deps.musicRepo.saveQueueState({ isShuffled: false });
  return readQueue(deps);
}
