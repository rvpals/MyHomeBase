"use server";

import { revalidatePath } from "next/cache";
import { clearStartupMessage } from "@/lib/settings";
import { deps } from "@/lib/wiring";

export interface DismissStartupMessageResult {
  ok: boolean;
  error?: string;
}

/**
 * Clears the startup message once the user has read it, so it shows exactly once.
 *
 * It is a single app-wide row, so dismissing it dismisses it for every user — that
 * is intended: the message announces a deployment, not something personal.
 */
export async function dismissStartupMessageAction(): Promise<DismissStartupMessageResult> {
  try {
    clearStartupMessage(deps.settingsRepo);
    // Without this, navigating back to the home screen can replay a cached RSC
    // payload that still carries the message.
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to dismiss the message.",
    };
  }
}
