"use server";

import { revalidatePath } from "next/cache";
import { saveModuleSettingsPartial } from "@/lib/module-settings";
import { getModuleBySlug } from "@/lib/modules";
import {
  runScheduledRefreshNow,
  scheduledRefreshSettingsSchema,
  scheduledRefreshSettingsToEntries,
  STOCK_ETFS_MODULE_SLUG,
  type ScheduledRefreshSettingsInput,
  type ScheduledRefreshSummary,
} from "@/lib/scheduled-refresh";
import { deps } from "@/lib/wiring";

const STOCK_ETFS_MODULE_PATH = "/modules/stock-etfs";

export interface SaveAutoRefreshResult {
  ok: boolean;
  error?: string;
}

/**
 * Persists the auto-refresh switch and interval as module settings — the same
 * store the scan thresholds and the dashboard layout use.
 *
 * Saved through `saveModuleSettingsPartial`, not `saveModuleSettings`. The
 * wholesale save deletes every row for the module and reinserts only what it is
 * handed, so writing just these two keys with it would wipe the thresholds and
 * the dashboard layout. Validation is the lib's schema, not this adapter's.
 */
export async function saveAutoRefreshSettingsAction(
  input: ScheduledRefreshSettingsInput,
): Promise<SaveAutoRefreshResult> {
  try {
    const stockModule = getModuleBySlug(deps.moduleRepo, STOCK_ETFS_MODULE_SLUG);
    if (!stockModule) throw new Error("Stocks & ETFs module not found.");

    const validated = scheduledRefreshSettingsSchema.parse(input);
    saveModuleSettingsPartial(
      deps.moduleSettingsRepo,
      stockModule.id,
      scheduledRefreshSettingsToEntries(validated),
    );
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to save the auto-refresh settings.",
    };
  }
  revalidatePath(STOCK_ETFS_MODULE_PATH);
  return { ok: true };
}

export interface RunAutoRefreshNowResult {
  ok: boolean;
  summary?: ScheduledRefreshSummary;
  error?: string;
}

/**
 * Runs a full refresh pass immediately, ignoring the switch and the interval.
 *
 * An explicit request is not a background job, so the master switch doesn't gate
 * it — the same reasoning that lets the expense module's "Run import now" work
 * with its switch off. It still stamps the run, so pressing this also postpones
 * the next scheduled pass instead of leaving one queued a minute later.
 */
export async function runAutoRefreshNowAction(): Promise<RunAutoRefreshNowResult> {
  try {
    const summary = await runScheduledRefreshNow({ force: true });
    revalidatePath(STOCK_ETFS_MODULE_PATH);
    return { ok: true, summary };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to run the refresh.",
    };
  }
}
