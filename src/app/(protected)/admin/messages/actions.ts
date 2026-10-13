"use server";

// Administration → Message Queue: the web adapters for reading and deleting.
//
// Thin, per ARCHITECTURE.md: authorise, call a `lib` use-case, return its result.
// The behaviour lives in `src/lib/messages` and is driven identically by
// `npm run cli -- messages delete` and `npm run cli -- messages prune`.

import { revalidatePath } from "next/cache";
import {
  deleteMessages,
  listAllMessages,
  markMessagesRead,
  pruneMessages,
  setMessagesLocked,
  type SystemMessage,
} from "@/lib/messages";
import { deps } from "@/lib/wiring";
import { requireAdmin } from "../../require-access";

const MESSAGES_PATH = "/admin/messages";

export interface MessageAdminResult {
  ok: boolean;
  /** How many rows the call actually changed. Absent when it failed. */
  count?: number;
  error?: string;
}

function toErrorResult(error: unknown, fallback: string): MessageAdminResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

/**
 * `requireAdmin`, not the `requireUser` the header bell's actions use.
 *
 * Reading the queue is something every signed-in reader already does from the
 * header. *Deleting* from it is not: the queue is the app's only record that a
 * monitor ever fired, so removing one is administration. This screen reads and
 * deletes in one place, and the read is guarded to match the writes beside it —
 * an admin screen's loader should not be the one endpoint on it that isn't.
 *
 * Each action is its own POST endpoint, so the admin layout's redirect does not
 * stand between a caller and these functions.
 */
export async function loadAllMessagesAction(): Promise<SystemMessage[]> {
  await requireAdmin();
  return listAllMessages(deps.messageRepo);
}

/**
 * Deletes the ticked rows, permanently.
 *
 * Returns how many actually went — an id another tab already deleted counts 0
 * rather than throwing, but an *empty selection* does throw, because that is a
 * deliberate act with nothing selected and the admin needs to hear about it.
 *
 * **Locked rows are kept**, so the count can be lower than the number of ids
 * passed. The view counts them before calling and says which were spared.
 */
export async function deleteMessagesAction(ids: number[]): Promise<MessageAdminResult> {
  try {
    await requireAdmin();
    const count = deleteMessages(deps.messageRepo, ids);
    revalidatePath(MESSAGES_PATH);
    return { ok: true, count };
  } catch (error) {
    return toErrorResult(error, "Failed to delete the selected messages.");
  }
}

/**
 * Marks the ticked rows read.
 *
 * `requireAdmin`, not the `requireUser` the header bell's equivalent uses — not
 * because reading is privileged, but because every endpoint on an admin screen
 * should be guarded the same way, and this one sits beside two deletes. A reader
 * who only wants to clear the badge has the bell.
 *
 * Tolerant of an id already read: the count is what actually changed.
 */
export async function markMessagesReadAction(ids: number[]): Promise<MessageAdminResult> {
  try {
    await requireAdmin();
    const count = markMessagesRead(deps.messageRepo, ids);
    revalidatePath(MESSAGES_PATH);
    return { ok: true, count };
  } catch (error) {
    return toErrorResult(error, "Failed to mark the selected messages read.");
  }
}

/**
 * Locks or unlocks the ticked rows.
 *
 * A locked message survives both the bulk delete and the age purge, so this is
 * the only thing standing between a kept message and the next purge window an
 * admin picks. Unlocking is the only route to deleting one.
 */
export async function setMessagesLockedAction(
  ids: number[],
  locked: boolean,
): Promise<MessageAdminResult> {
  try {
    await requireAdmin();
    const count = setMessagesLocked(deps.messageRepo, ids, locked);
    revalidatePath(MESSAGES_PATH);
    return { ok: true, count };
  } catch (error) {
    return toErrorResult(
      error,
      locked ? "Failed to lock the selected messages." : "Failed to unlock them.",
    );
  }
}

/**
 * Deletes every message older than `retentionDays`, keeping the recent ones.
 *
 * Nothing calls this on a timer — there is no scheduled prune for the queue, by
 * choice. It runs when an admin picks a window and presses the button.
 *
 * Locked messages survive it however old they are.
 */
export async function pruneMessagesAction(
  retentionDays: number,
): Promise<MessageAdminResult> {
  try {
    await requireAdmin();
    const count = pruneMessages(deps.messageRepo, retentionDays);
    revalidatePath(MESSAGES_PATH);
    return { ok: true, count };
  } catch (error) {
    return toErrorResult(error, "Failed to purge old messages.");
  }
}
