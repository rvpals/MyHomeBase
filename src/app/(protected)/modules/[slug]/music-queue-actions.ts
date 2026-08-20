"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import {
  advanceQueue,
  clearQueue,
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

// Server actions for the play queue. Its own file rather than more of music-actions.ts,
// which is already long and covers a different concern.
//
// Thin by the same rule as every other adapter here: parse with a lib schema, call a lib
// use-case, return what it returned. Every one of these hands back the whole PlayQueue,
// because the caller is a screen that must now render it -- see queue-use-cases.ts.

async function requireUser() {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) throw new Error("Not signed in.");
  return currentUser;
}

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
  await requireUser();
  return toViewModel(getPlayQueue(deps));
}

export async function setQueueAction(input: {
  trackIds: number[];
  startIndex?: number;
}): Promise<QueueViewModel> {
  await requireUser();
  return toViewModel(setQueue(setQueueSchema.parse(input), deps));
}

export async function enqueueTracksAction(input: {
  trackIds: number[];
}): Promise<QueueViewModel> {
  await requireUser();
  return toViewModel(enqueueTracks(enqueueSchema.parse(input), deps));
}

export async function playQueueEntryAction(entryId: number): Promise<QueueViewModel> {
  await requireUser();
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
  await requireUser();
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
  await requireUser();
  const result = rewindQueue(deps);
  return { queue: toViewModel(result.queue), playingEntryId: result.playing?.entry.id };
}

export async function shuffleQueueAction(): Promise<QueueViewModel> {
  await requireUser();
  return toViewModel(shuffleQueue(deps));
}

export async function removeQueueEntryAction(entryId: number): Promise<QueueViewModel> {
  await requireUser();
  return toViewModel(removeQueueEntry({ entryId: queueEntryIdSchema.parse(entryId) }, deps));
}

export async function clearQueueAction(): Promise<QueueViewModel> {
  await requireUser();
  return toViewModel(clearQueue(deps));
}

export async function setRepeatModeAction(repeatMode: string): Promise<QueueViewModel> {
  await requireUser();
  return toViewModel(setRepeatMode({ repeatMode: repeatModeSchema.parse(repeatMode) }, deps));
}

export async function reorderQueueAction(input: {
  orderedEntryIds: number[];
}): Promise<QueueViewModel> {
  await requireUser();
  return toViewModel(reorderQueue(reorderQueueSchema.parse(input), deps));
}
