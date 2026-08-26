// The composite "refresh everything" pass: prices, then sectors, then today's
// snapshot -- the same three steps, in the same order, that the dashboard's
// Refresh All control walks (src/app/(protected)/modules/[slug]/stock-refresh-control.tsx).
//
// It exists because that order was previously only expressed in a client
// component, assembled from three separate server actions. A scheduler could not
// reuse it, so the cron path and the button path would have drifted the first time
// one of them changed. This is the one definition of the sequence; the button and
// the timer are two callers of it.
//
// Pure orchestration: every dependency is passed in, so the whole pass runs in a
// unit test with fakes and no network. `refresh-runner.ts` is the adapter that
// resolves the real ones from `deps`.

import { refreshAllPositions, type StockPositionRepository } from "@/lib/stock-positions";
import type { MarketDataClient } from "@/lib/market-data";
import { captureDailySnapshot, type DailySnapshotRepository } from "@/lib/stock-daily-snapshot";
import {
  refreshTickerProfiles,
  type TickerProfileClient,
  type TickerProfileRepository,
} from "@/lib/ticker-profiles";
import type { ScheduledRefreshSummary, ScheduledRunStatus } from "./types";

export interface ScheduledRefreshDeps {
  positionRepo: StockPositionRepository;
  marketDataClient: MarketDataClient;
  profileRepo: TickerProfileRepository;
  profileClient: TickerProfileClient;
  snapshotRepo: DailySnapshotRepository;
  /** Today, local-calendar "YYYY-MM-DD". Injected so a test doesn't depend on the clock. */
  today: string;
}

/** Builds the one-line summary stored in `sys_scheduled_runs.last_detail`. */
function describe(summary: Omit<ScheduledRefreshSummary, "detail">): string {
  const parts = [`${summary.pricedCount} priced`];
  if (summary.failedCount > 0) parts.push(`${summary.failedCount} failed`);
  if (summary.sectorsFetchedCount > 0) parts.push(`${summary.sectorsFetchedCount} sector(s)`);
  parts.push(summary.snapshotSaved ? "snapshot saved" : "snapshot not saved");
  return parts.join(", ");
}

/**
 * Runs one full refresh pass.
 *
 * Ordering matters and mirrors the button exactly:
 *
 * 1. **Prices first.** `refreshAllPositions` already tolerates a per-ticker
 *    failure, so one delisted symbol doesn't stop the rest.
 * 2. **Sectors second**, because the allocation chart labels the positions that
 *    step just priced. Almost always a no-op -- a sector is cached for 90 days --
 *    and it never fails the pass: a missing chart label is not a reason to report
 *    that a price update went wrong.
 * 3. **Snapshot last**, so it totals the prices this pass just stored rather than
 *    yesterday's. It replaces today's row if there is one, which is what makes
 *    running this repeatedly on the same day safe.
 *
 * Never throws. A background job that raises inside a timer callback becomes an
 * unhandled rejection and can take the server down, so every failure is reported
 * in the returned summary instead.
 */
export async function runScheduledRefresh(
  deps: ScheduledRefreshDeps,
): Promise<ScheduledRefreshSummary> {
  const empty = {
    pricedCount: 0,
    failedCount: 0,
    sectorsFetchedCount: 0,
    snapshotSaved: false,
  };

  // Nothing to price is a skip, not a failure: an install with no positions yet is
  // correctly configured, it just has no work.
  if (deps.positionRepo.listPositions().length === 0) {
    return { ran: false, reason: "No positions to refresh.", ...empty, detail: "nothing to do" };
  }

  let pricedCount = 0;
  let failedCount = 0;
  try {
    const { refreshed, failed } = await refreshAllPositions(
      deps.positionRepo,
      deps.marketDataClient,
    );
    pricedCount = refreshed.length;
    failedCount = failed.length;
  } catch (error) {
    // The whole price step blew up (not one ticker -- that lands in `failed`),
    // so there is nothing worth snapshotting.
    return {
      ran: true,
      status: "failed",
      ...empty,
      detail: error instanceof Error ? error.message : "Price refresh failed.",
    };
  }

  // Sectors for the allocation chart. Swallowed on purpose -- see step 2 above.
  let sectorsFetchedCount = 0;
  try {
    const tickers = deps.positionRepo.listPositions().map((position) => position.ticker);
    const profiles = await refreshTickerProfiles(deps.profileRepo, deps.profileClient, tickers);
    sectorsFetchedCount = profiles.fetched.length;
  } catch {
    // Deliberately ignored.
  }

  let snapshotSaved = false;
  let snapshotError: string | undefined;
  try {
    captureDailySnapshot(deps.snapshotRepo, deps.positionRepo.listPositions(), deps.today);
    snapshotSaved = true;
  } catch (error) {
    snapshotError = error instanceof Error ? error.message : "Snapshot failed.";
  }

  // `partial` covers both "some tickers couldn't be priced" and "prices landed but
  // the snapshot didn't" -- in each case the pass did real work and also lost some.
  const status: ScheduledRunStatus =
    !snapshotSaved || failedCount > 0 ? (pricedCount > 0 ? "partial" : "failed") : "ok";

  const counts = { pricedCount, failedCount, sectorsFetchedCount, snapshotSaved };
  const detail = snapshotError
    ? `${describe({ ran: true, status, ...counts })} — ${snapshotError}`
    : describe({ ran: true, status, ...counts });

  return { ran: true, status, ...counts, detail };
}
