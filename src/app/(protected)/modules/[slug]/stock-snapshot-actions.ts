"use server";

import { revalidatePath } from "next/cache";
import { todayIsoLocal } from "@/lib/shared/date";
import { captureDailySnapshot, type DailySnapshot } from "@/lib/stock-daily-snapshot";
import { listPositions } from "@/lib/stock-positions";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "../../require-access";

/** The module these actions belong to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "investments";

const INVESTMENTS_MODULE_PATH = "/modules/investments";

export interface CaptureSnapshotResult {
  ok: boolean;
  snapshot?: DailySnapshot;
  error?: string;
}

/**
 * Files today's portfolio value and day move under today's date, replacing that
 * date's row if it already exists.
 *
 * Called after the dashboard's refresh loop has finished, so it reads the prices
 * that loop just stored rather than fetching anything itself — which is also what
 * makes it safe to press Refresh All repeatedly: each pass recomputes and
 * overwrites the same day.
 */
export async function captureDailySnapshotAction(): Promise<CaptureSnapshotResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const snapshot = captureDailySnapshot(
      deps.stockDailySnapshotRepo,
      listPositions(deps.stockPositionRepo),
      todayIsoLocal(),
    );
    revalidatePath(INVESTMENTS_MODULE_PATH);
    return { ok: true, snapshot };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to save today's snapshot.",
    };
  }
}
