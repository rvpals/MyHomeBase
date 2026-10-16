"use server";

import { revalidatePath } from "next/cache";
import { listPendingPopupMessages, markMessagesRead } from "@/lib/messages";
import { deps } from "@/lib/wiring";
import { requireUser } from "./require-access";

export interface DismissMonitorPopupsResult {
  ok: boolean;
  error?: string;
}

/**
 * Which of these notices are still pending, asked at render time.
 *
 * The home screen's popups come from a **server render that may be cached**,
 * and the bell can mark the same messages read without revalidating `/` (see
 * `messages-actions.ts`, which deliberately stays cheap). So a reader who
 * clears the queue from the bell and then returns home could be shown a notice
 * they have already dealt with.
 *
 * The dialog therefore confirms before it draws. Checked rather than fixed by
 * revalidating `/` on every mark-read: the bell is the hot path and the home
 * screen is not, so the cost belongs on the rarer side.
 */
export async function pendingMonitorPopupIdsAction(
  messageIds: number[],
): Promise<number[]> {
  await requireUser();
  const stillPending = new Set(
    listPendingPopupMessages(deps.messageRepo).map((message) => message.id),
  );
  return messageIds.filter((id) => stillPending.has(id));
}

/**
 * Dismisses the monitor popups the home screen just showed, by marking those
 * messages read.
 *
 * **Marking them read IS the dismissal** — there is no separate dismissed
 * column (migrations/0149). So clicking OK also clears them from the bell
 * badge, which is the intended second effect: the popup and the queue entry are
 * one record, and a notice you have just read on screen should not still be
 * counted as unread behind the bell.
 *
 * `requireUser`, not `requireModuleAccess("investments")`: the popups are
 * rendered on the home screen, which no module owns, and the ids were produced
 * by a server render that already filtered to what this reader may see. The
 * action is its own POST endpoint, so the page's own read does not guard it —
 * hence a guard here regardless.
 *
 * Dismissing is household-wide, like the monitors (0110) and the queue (0109):
 * whoever clicks OK clears it for everyone.
 */
export async function dismissMonitorPopupsAction(
  messageIds: number[],
): Promise<DismissMonitorPopupsResult> {
  try {
    await requireUser();
    // An empty list is a caller bug, and `markMessagesReadSchema` rejects it
    // rather than silently succeeding — the dialog never renders without ids.
    markMessagesRead(deps.messageRepo, messageIds);
    // Without this, navigating back to the home screen can replay a cached RSC
    // payload that still carries the dismissed popups — the same trap
    // `dismissStartupMessageAction` documents.
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to dismiss the notice.",
    };
  }
}
