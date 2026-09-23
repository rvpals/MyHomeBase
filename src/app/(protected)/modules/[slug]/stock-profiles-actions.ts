"use server";

import { revalidatePath } from "next/cache";
import { listPositions } from "@/lib/stock-positions";
import {
  getOrFetchTickerProfile,
  NO_SECTOR_LABEL,
  refreshTickerProfiles,
  resolveSector,
} from "@/lib/ticker-profiles";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "../../require-access";

/** The module these actions belong to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "investments";

const INVESTMENTS_MODULE_PATH = "/modules/investments";

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
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const tickers = listPositions(deps.stockPositionRepo).map((position) => position.ticker);
    const result = await refreshTickerProfiles(
      deps.tickerProfileRepo,
      deps.tickerProfileClient,
      tickers,
    );

    // Only worth re-rendering when something new landed.
    if (result.fetched.length > 0) revalidatePath(INVESTMENTS_MODULE_PATH);

    return { ok: true, fetchedCount: result.fetched.length, failedCount: result.failed.length };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to look up sectors.",
    };
  }
}

export interface TickerSectorResult {
  /** The resolved sector, or "" when the provider has none (a fund often hasn't). */
  sector: string;
  /** The provider's industry, or "" when it reported none. */
  industry: string;
}

/**
 * One ticker's sector and industry, for the Consult AI prompt.
 *
 * Reads the 90-day cache and only calls the provider for a symbol that isn't in
 * it — so the common case is a single indexed row, not a round trip. It resolves
 * through `resolveSector`, which means a sector the owner has set by hand wins
 * over the provider's, exactly as it does on the dashboard charts.
 *
 * A failure returns blanks rather than throwing: the consult prompt has a branch
 * that asks the model to establish the sector itself, so a missing answer
 * degrades the prompt without breaking it.
 */
export async function getTickerSectorAction(ticker: string): Promise<TickerSectorResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const record = await getOrFetchTickerProfile(
      deps.tickerProfileRepo,
      deps.tickerProfileClient,
      ticker,
    );
    const resolved = resolveSector(record);

    return {
      // The fallback label means "we have no sector", which the prompt must read
      // as absent rather than as a sector literally called "Unclassified".
      sector: resolved === NO_SECTOR_LABEL ? "" : resolved,
      industry: record?.industry ?? "",
    };
  } catch {
    return { sector: "", industry: "" };
  }
}
