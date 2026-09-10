"use server";

import {
  advanceQueue,
  clearQueue,
  closeQueue,
  enqueueSchema,
  enqueueTracks,
  getPlayQueue,
  playQueueEntry,
  queueEntryIdSchema,
  removeQueueEntry,
  reorderQueue,
  reorderQueueSchema,
  repeatModeSchema,
  rewindQueue,
  setQueue,
  setQueueSchema,
  setRepeatMode,
  shuffleQueue,
  type PlayQueue,
} from "@/lib/music";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "../../require-access";

/** The module these actions belong to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "music-library";

// Server actions for the play queue. Its own file rather than more of music-actions.ts,
// which is already long and covers a different concern.
//
// Thin by the same rule as every other adapter here: parse with a lib schema, call a lib
// use-case, return what it returned. Every one of these hands back the whole PlayQueue,
// because the caller is a screen that must now render it -- see queue-use-cases.ts.

/**
 * A serialisable view of the queue.
 *
 * The domain `QueueItem` carries a full `Track` (file size, mtime, mime type, cue-sheet
 * flag). A list row needs six of those fields, and everything here crosses the server
 * boundary on every queue change, so it is narrowed rather than passed whole.
 */
export interface QueueRow {
  entryId: number;
  trackId: number;
  displayTitle: string;
  artist: string;
  album: string;
  albumId?: number;
  durationSeconds?: number;
  extension: string;
  isStreamable: boolean;
}

export interface QueueViewModel {
  rows: QueueRow[];
  currentEntryId?: number;
  repeatMode: "off" | "all" | "one";
  isShuffled: boolean;
  /** Seconds. Precomputed here so the view does no arithmetic over the list. */
  totalSeconds: number;
  remainingSeconds: number;
}

function toViewModel(queue: PlayQueue): QueueViewModel {
  const currentPosition = queue.items.findIndex(
    (item) => item.entry.id === queue.state.currentEntryId,
  );

  return {
    rows: queue.items.map((item) => ({
      entryId: item.entry.id,
      trackId: item.track.id,
      displayTitle: item.track.displayTitle,
      artist: item.track.artist,
      album: item.track.album,
      albumId: item.track.albumId,
      durationSeconds: item.track.durationSeconds,
      extension: item.track.extension,
      isStreamable: item.track.isStreamable,
    })),
    currentEntryId: queue.state.currentEntryId,
    repeatMode: queue.state.repeatMode,
    isShuffled: queue.state.isShuffled,
    totalSeconds: queue.items.reduce(
      (total, item) => total + (item.track.durationSeconds ?? 0),
      0,
    ),
    remainingSeconds: queue.items
      .slice(currentPosition === -1 ? 0 : currentPosition + 1)
      .reduce((total, item) => total + (item.track.durationSeconds ?? 0), 0),
  };
}

export async function getQueueAction(): Promise<QueueViewModel> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  return toViewModel(getPlayQueue(deps));
}

export async function setQueueAction(input: {
  trackIds: number[];
  startIndex?: number;
}): Promise<QueueViewModel> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  return toViewModel(setQueue(setQueueSchema.parse(input), deps));
}

export async function enqueueTracksAction(input: {
  trackIds: number[];
}): Promise<QueueViewModel> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  return toViewModel(enqueueTracks(enqueueSchema.parse(input), deps));
}

export async function playQueueEntryAction(entryId: number): Promise<QueueViewModel> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  return toViewModel(playQueueEntry({ entryId: queueEntryIdSchema.parse(entryId) }, deps));
}

/**
 * Advances the queue and reports what should now play.
 *
 * `playing` is undefined at the end of a queue with repeat off, which the player reads
 * as "stop" rather than "error".
 */
export async function advanceQueueAction(isManual: boolean): Promise<{
  queue: QueueViewModel;
  playingEntryId?: number;
}> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  const result = advanceQueue({ isManual }, deps);
  return {
    queue: toViewModel(result.queue),
    playingEntryId: result.playing?.entry.id,
  };
}

export async function rewindQueueAction(): Promise<{
  queue: QueueViewModel;
  playingEntryId?: number;
}> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  const result = rewindQueue(deps);
  return { queue: toViewModel(result.queue), playingEntryId: result.playing?.entry.id };
}

export async function shuffleQueueAction(): Promise<QueueViewModel> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  return toViewModel(shuffleQueue(deps));
}

export async function removeQueueEntryAction(entryId: number): Promise<QueueViewModel> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  return toViewModel(removeQueueEntry({ entryId: queueEntryIdSchema.parse(entryId) }, deps));
}

export async function clearQueueAction(): Promise<QueueViewModel> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  return toViewModel(clearQueue(deps));
}

/**
 * Hides the player bar, keeping the queue.
 *
 * Distinct from `clearQueueAction`: this only drops the cursor, so the entries are still
 * there when you come back. See `closeQueue`.
 */
export async function closeQueueAction(): Promise<QueueViewModel> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  return toViewModel(closeQueue(deps));
}

export async function setRepeatModeAction(repeatMode: string): Promise<QueueViewModel> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  return toViewModel(setRepeatMode({ repeatMode: repeatModeSchema.parse(repeatMode) }, deps));
}

export async function reorderQueueAction(input: {
  orderedEntryIds: number[];
}): Promise<QueueViewModel> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  return toViewModel(reorderQueue(reorderQueueSchema.parse(input), deps));
}
