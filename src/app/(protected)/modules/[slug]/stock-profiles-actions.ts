"use server";

import { revalidatePath } from "next/cache";
import { listPositions } from "@/lib/stock-positions";
import { refreshTickerProfiles } from "@/lib/ticker-profiles";
import { deps } from "@/lib/wiring";

const STOCK_ETFS_MODULE_PATH = "/modules/stock-etfs";

export interface RefreshProfilesActionResult {
  ok: boolean;
  /** How many tickers were looked up on this run. Skipped ones aren't counted. */
  fetchedCount?: number;
  failedCount?: number;
  error?: string;
}

/**
 * Brings the sector cache up to date for every held ticker.
 *
 * Called at the end of the dashboard's Refresh All, after prices land. Almost
 * always a no-op: a ticker's sector is fetched once and then skipped for 90
 * days, so this only costs a round trip for symbols bought since the last run.
 *
 * Never fails the refresh — a dashboard chart missing a label is not a reason to
 * report that a price update went wrong, so an error is returned rather than
 * thrown and the caller reports it as a footnote.
 */
export async function refreshTickerProfilesAction(): Promise<RefreshProfilesActionResult> {
  try {
    const tickers = listPositions(deps.stockPositionRepo).map((position) => position.ticker);
    const result = await refreshTickerProfiles(
      deps.tickerProfileRepo,
      deps.tickerProfileClient,
      tickers,
    );

    // Only worth re-rendering when something new landed.
    if (result.fetched.length > 0) revalidatePath(STOCK_ETFS_MODULE_PATH);

    return { ok: true, fetchedCount: result.fetched.length, failedCount: result.failed.length };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to look up sectors.",
    };
  }
}
