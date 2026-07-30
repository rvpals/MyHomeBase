"use server";

import { getRandomQuote, type DailyQuote } from "@/lib/daily-quote";
import { deps } from "@/lib/wiring";

export interface DrawQuoteResult {
  ok: boolean;
  quote?: DailyQuote;
  error?: string;
}

/**
 * Draws a fresh random quote for the home-screen widget's refresh button. With a
 * small quote table the same quote can legitimately come up again — the pick is
 * independent, not a rotation.
 */
export async function drawRandomQuoteAction(): Promise<DrawQuoteResult> {
  try {
    const quote = getRandomQuote(deps.dailyQuoteRepo);
    if (!quote) return { ok: false, error: "No quotes are available." };
    return { ok: true, quote };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to draw a quote." };
  }
}
