"use server";

import { indexBoardSchema, loadIndexBoard, type IndexBoard } from "@/lib/market-indexes";
import { deps } from "@/lib/wiring";

export interface LoadIndexBoardActionResult {
  ok: boolean;
  error?: string;
  board?: IndexBoard;
}

/**
 * Validate, fetch, return. No `revalidatePath` — the board is read-only and
 * nothing is stored, so there is no server-rendered data to invalidate; the
 * result lives in the card's own state until the next Refresh all.
 *
 * A partly-failed board is still a success: `loadIndexBoard` reports dead symbols
 * in `board.failures` rather than throwing, and the card shows the rows it got.
 * This returns `ok: false` only when the whole call failed (a bad input, or the
 * fetch layer throwing outright).
 */
export async function loadIndexBoardAction(input: {
  symbols?: string[];
} = {}): Promise<LoadIndexBoardActionResult> {
  const parsed = indexBoardSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid index request." };
  }

  try {
    return { ok: true, board: await loadIndexBoard(deps.marketDataClient, parsed.data) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to load the index board.",
    };
  }
}
