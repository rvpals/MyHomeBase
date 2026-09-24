"use server";

// The message queue's web adapters.
//
// Thin, per ARCHITECTURE.md: authorise, call a `lib` use-case, return its
// result. The queue's behaviour lives in `src/lib/messages` and is driven
// identically by `npm run cli -- messages`.

import {
  countMessages,
  getMessageQueue,
  markAllMessagesRead,
  markMessagesRead,
  type SystemMessage,
} from "@/lib/messages";
import { deps } from "@/lib/wiring";
import { requireUser } from "./require-access";

/**
 * `requireUser`, not `requireModuleAccess`: the queue belongs to no module. It
 * is app-wide chrome every signed-in reader sees, which is the same rule the
 * home-screen widget actions follow.
 *
 * It is still guarded — an action is its own POST endpoint, so the
 * `(protected)` layout does not stand between a caller and this function.
 */

export async function loadMessageQueueAction(): Promise<{
  unread: SystemMessage[];
  read: SystemMessage[];
}> {
  await requireUser();
  const queue = getMessageQueue(deps.messageRepo);
  return { unread: queue.unread, read: queue.read };
}

/** Just the badge's number, for a caller that isn't opening the window. */
export async function countUnreadMessagesAction(): Promise<number> {
  await requireUser();
  return countMessages(deps.messageRepo).unread;
}

/** Returns how many rows actually changed — an already-read id counts 0. */
export async function markMessagesReadAction(messageIds: number[]): Promise<number> {
  await requireUser();
  return markMessagesRead(deps.messageRepo, messageIds);
}

export async function markAllMessagesReadAction(): Promise<number> {
  await requireUser();
  return markAllMessagesRead(deps.messageRepo);
}
